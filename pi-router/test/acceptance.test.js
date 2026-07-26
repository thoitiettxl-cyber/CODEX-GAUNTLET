import assert from "node:assert/strict";
import test from "node:test";

import { createPiRouterServer, listenPiRouter } from "../src/server.js";
import { MODEL, addressUrl, closeServer, message, textStream } from "./helpers.js";

test("function call and function output complete a two-request Responses round trip", async (t) => {
	const contexts = [];
	const runtime = {
		async listModels() {
			return [MODEL];
		},
		async resolveModel() {
			return MODEL;
		},
		stream(_model, context) {
			contexts.push(context);
			if (contexts.length === 1) {
				const toolCall = {
					type: "toolCall",
					id: "call_weather",
					name: "weather",
					arguments: { city: "Hue" },
				};
				return (async function* () {
					yield {
						type: "toolcall_end",
						contentIndex: 0,
						toolCall,
						partial: message([toolCall], "toolUse"),
					};
					yield { type: "done", reason: "toolUse", message: message([toolCall], "toolUse") };
				})();
			}
			return textStream("It is sunny.");
		},
	};
	const server = createPiRouterServer({ runtime, apiKey: "acceptance-key" });
	const address = await listenPiRouter(server, { port: 0 });
	t.after(() => closeServer(server));
	const endpoint = `${addressUrl(address)}/v1/responses`;
	const headers = {
		authorization: "Bearer acceptance-key",
		"content-type": "application/json",
	};
	const first = await fetch(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: "fake/model",
			input: "What is the weather?",
			tools: [{
				type: "function",
				name: "weather",
				parameters: { type: "object", properties: { city: { type: "string" } } },
			}],
		}),
	}).then((response) => response.json());
	assert.equal(first.output[0].type, "function_call");
	const second = await fetch(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: "fake/model",
			input: [
				first.output[0],
				{ type: "function_call_output", call_id: first.output[0].call_id, output: "sunny" },
			],
		}),
	}).then((response) => response.json());
	assert.equal(second.output[0].content[0].text, "It is sunny.");
	assert.equal(contexts[1].messages[1].role, "toolResult");
	assert.equal(contexts[1].messages[1].toolName, "weather");
});

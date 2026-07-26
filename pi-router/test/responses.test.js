import assert from "node:assert/strict";
import test from "node:test";

import { collectResponse, requestToPi, translatePiStream } from "../src/responses.js";
import { MODEL, message, textStream } from "./helpers.js";

test("request conversion preserves instructions, messages, tools, and limits", () => {
	const converted = requestToPi(
		{
			model: "fake/model",
			instructions: "Be brief.",
			input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
			tools: [{
				type: "function",
				name: "weather",
				description: "Get weather",
				parameters: { type: "object", properties: { city: { type: "string" } } },
				strict: true,
			}],
			reasoning: { effort: "high" },
			max_output_tokens: 200,
		},
		MODEL,
		123,
	);
	assert.equal(converted.context.systemPrompt, "Be brief.");
	assert.deepEqual(converted.context.messages, [{ role: "user", content: "Hi", timestamp: 123 }]);
	assert.equal(converted.context.tools[0].name, "weather");
	assert.deepEqual(converted.context.tools[0].constrainedSampling, {
		type: "json_schema",
		strict: "require",
	});
	assert.equal(converted.options.reasoning, "high");
	assert.equal(converted.options.maxTokens, 200);
});

test("function call output becomes a Pi tool result with its tool name", () => {
	const converted = requestToPi(
		{
			model: "fake/model",
			input: [
				{ type: "function_call", call_id: "call_1", name: "weather", arguments: "{\"city\":\"Hue\"}" },
				{ type: "function_call_output", call_id: "call_1", output: "sunny" },
			],
		},
		MODEL,
		456,
	);
	assert.equal(converted.context.messages[0].content[0].type, "toolCall");
	assert.deepEqual(converted.context.messages[0].content[0].arguments, { city: "Hue" });
	assert.deepEqual(converted.context.messages[1], {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "weather",
		content: [{ type: "text", text: "sunny" }],
		isError: false,
		timestamp: 456,
	});
});

test("unsupported and stateful inputs fail instead of being dropped", () => {
	assert.throws(
		() => requestToPi({ input: [{ type: "image_generation_call" }] }, MODEL),
		/unsupported/,
	);
	assert.throws(
		() => requestToPi({ input: "hello", previous_response_id: "resp_old" }, MODEL),
		/previous_response_id/,
	);
	assert.throws(
		() => requestToPi({ input: "hello", store: true }, MODEL),
		/stored responses/,
	);
	assert.throws(
		() => requestToPi({ input: "hello", conversation: "conv_old" }, MODEL),
		/conversation state/,
	);
	assert.throws(
		() => requestToPi({
			input: [{ type: "function_call_output", call_id: "missing", output: "x" }],
		}, MODEL),
		/no matching function_call/,
	);
	assert.throws(
		() => requestToPi({
			input: [
				{ type: "function_call", call_id: "same", name: "one", arguments: "{}" },
				{ type: "function_call", call_id: "same", name: "two", arguments: "{}" },
			],
		}, MODEL),
		/must be unique/,
	);
});

test("text stream has monotonic typed lifecycle and a completed response", async () => {
	const events = [];
	for await (const event of translatePiStream(textStream("hello"), {
		body: { model: "fake/model", input: "Hi", stream: true },
		modelName: "fake/model",
		now: 1000,
	})) {
		events.push(event);
	}
	assert.deepEqual(
		events.map((event) => event.sequence_number),
		events.map((_, index) => index),
	);
	assert.equal(events[0].type, "response.created");
	assert.equal(events.at(-1).type, "response.completed");
	assert.ok(events.some((event) => event.type === "response.output_text.delta"));
	const response = await collectResponse((async function* () {
		yield* events;
	})());
	assert.equal(response.output[0].content[0].text, "hello");
	assert.equal(response.usage.total_tokens, 5);
});

test("tool calls become Responses function-call items", async () => {
	const toolCall = {
		type: "toolCall",
		id: "call_7",
		name: "weather",
		arguments: { city: "Hue" },
	};
	async function* stream() {
		yield { type: "toolcall_end", contentIndex: 0, toolCall, partial: message([toolCall], "toolUse") };
		yield { type: "done", reason: "toolUse", message: message([toolCall], "toolUse") };
	}
	const events = [];
	for await (const event of translatePiStream(stream(), {
		body: { model: "fake/model", input: "weather?" },
		modelName: "fake/model",
		now: 1000,
	})) {
		events.push(event);
	}
	assert.ok(events.some((event) => event.type === "response.function_call_arguments.delta"));
	assert.ok(events.some((event) => event.type === "response.function_call_arguments.done"));
	const response = events.at(-1).response;
	assert.deepEqual(
		{
			type: response.output[0].type,
			call_id: response.output[0].call_id,
			name: response.output[0].name,
			arguments: response.output[0].arguments,
		},
		{
			type: "function_call",
			call_id: "call_7",
			name: "weather",
			arguments: "{\"city\":\"Hue\"}",
		},
	);
});

test("terminal Pi message repairs missing end events without duplicating items", async () => {
	const toolCall = {
		type: "toolCall",
		id: "call_fallback",
		name: "weather",
		arguments: { city: "Hue" },
	};
	async function* stream() {
		yield {
			type: "text_delta",
			contentIndex: 0,
			delta: "partial",
			partial: message([{ type: "text", text: "partial" }]),
		};
		yield {
			type: "done",
			reason: "toolUse",
			message: message([
				{ type: "text", text: "complete" },
				toolCall,
			], "toolUse"),
		};
	}
	const events = [];
	for await (const event of translatePiStream(stream(), {
		body: { model: "fake/model", input: "weather?" },
		modelName: "fake/model",
		now: 1000,
	})) {
		events.push(event);
	}
	assert.equal(events.filter((event) => event.type === "response.output_item.done").length, 2);
	assert.equal(events.at(-1).response.output[0].content[0].text, "complete");
	assert.equal(events.at(-1).response.output[1].call_id, "call_fallback");
});

import { once } from "node:events";

export const MODEL = Object.freeze({
	provider: "fake",
	id: "model",
	api: "openai-completions",
	name: "Fake Model",
});

export function message(content, stopReason = "stop") {
	return {
		role: "assistant",
		content,
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 3,
			output: 2,
			cacheRead: 1,
			cacheWrite: 0,
			totalTokens: 5,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

export async function* textStream(text = "hello") {
	const partial = message([{ type: "text", text: "" }]);
	yield { type: "start", partial };
	yield { type: "text_start", contentIndex: 0, partial };
	yield { type: "text_delta", contentIndex: 0, delta: text, partial };
	yield { type: "text_end", contentIndex: 0, content: text, partial };
	yield { type: "done", reason: "stop", message: message([{ type: "text", text }]) };
}

export async function closeServer(server) {
	server.close();
	await once(server, "close");
}

export function addressUrl(address) {
	const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
	return `http://${host}:${address.port}`;
}

export function fakeRuntime({ stream = () => textStream() } = {}) {
	return {
		async listModels() {
			return [MODEL];
		},
		async resolveModel(name) {
			if (name !== "fake/model" && name !== "model") {
				throw new Error("unexpected model");
			}
			return MODEL;
		},
		stream,
	};
}

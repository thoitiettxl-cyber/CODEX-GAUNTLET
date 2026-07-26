import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPiRouterServer, listenPiRouter, validateListenHost } from "../src/server.js";
import { addressUrl, closeServer, fakeRuntime, textStream } from "./helpers.js";

async function started(runtime = fakeRuntime()) {
	const server = createPiRouterServer({ runtime, apiKey: "local-test-key", now: () => 1000 });
	const address = await listenPiRouter(server, { host: "127.0.0.1", port: 0 });
	return { server, baseUrl: addressUrl(address) };
}

test("startup accepts only explicit loopback hosts", () => {
	assert.equal(validateListenHost("127.0.0.1"), "127.0.0.1");
	assert.equal(validateListenHost("::1"), "::1");
	for (const host of ["0.0.0.0", "::", "localhost", "192.168.1.2"]) {
		assert.throws(() => validateListenHost(host), /only/);
	}
});

test("health is bounded and v1 endpoints require bearer authentication", async (t) => {
	const { server, baseUrl } = await started();
	t.after(() => closeServer(server));
	const health = await fetch(`${baseUrl}/health`);
	assert.equal(health.status, 200);
	assert.deepEqual(await health.json(), { status: "ok", service: "pi-router", version: "0.1.0" });
	const unauthenticated = await fetch(`${baseUrl}/v1/models`);
	assert.equal(unauthenticated.status, 401);
	assert.equal((await unauthenticated.json()).error.code, "invalid_api_key");
	const models = await fetch(`${baseUrl}/v1/models`, {
		headers: { authorization: "Bearer local-test-key" },
	});
	assert.equal(models.status, 200);
	assert.deepEqual((await models.json()).data[0], {
		id: "fake/model",
		object: "model",
		created: 0,
		owned_by: "fake",
	});
});

test("non-streaming responses return a Responses JSON object", async (t) => {
	let captured;
	const runtime = fakeRuntime({
		stream(model, context, options) {
			captured = { model, context, options };
			return textStream("hello");
		},
	});
	const { server, baseUrl } = await started(runtime);
	t.after(() => closeServer(server));
	const result = await fetch(`${baseUrl}/v1/responses`, {
		method: "POST",
		headers: {
			authorization: "Bearer local-test-key",
			"content-type": "application/json",
		},
		body: JSON.stringify({ model: "fake/model", input: "Hi" }),
	});
	assert.equal(result.status, 200);
	const body = await result.json();
	assert.equal(body.object, "response");
	assert.equal(body.status, "completed");
	assert.equal(body.output[0].content[0].text, "hello");
	assert.equal(captured.context.messages[0].content, "Hi");
	assert.equal(captured.options.signal instanceof AbortSignal, true);
});

test("streaming responses use SSE and end in response.completed", async (t) => {
	const { server, baseUrl } = await started();
	t.after(() => closeServer(server));
	const result = await fetch(`${baseUrl}/v1/responses`, {
		method: "POST",
		headers: {
			authorization: "Bearer local-test-key",
			"content-type": "application/json",
		},
		body: JSON.stringify({ model: "fake/model", input: "Hi", stream: true }),
	});
	assert.match(result.headers.get("content-type"), /^text\/event-stream/);
	const frames = (await result.text()).trim().split("\n\n");
	const events = frames.map((frame) => {
		const lines = frame.split("\n");
		const eventName = lines.find((line) => line.startsWith("event: ")).slice("event: ".length);
		const event = JSON.parse(
			lines.find((line) => line.startsWith("data: ")).slice("data: ".length),
		);
		assert.equal(eventName, event.type);
		return event;
	});
	assert.equal(events[0].type, "response.created");
	assert.equal(events.at(-1).type, "response.completed");
	assert.deepEqual(events.map((event) => event.sequence_number), events.map((_, index) => index));
});

test("invalid JSON and provider failures use bounded error envelopes", async (t) => {
	const runtime = fakeRuntime();
	runtime.resolveModel = async () => {
		throw new Error("raw-upstream-secret-detail");
	};
	const { server, baseUrl } = await started(runtime);
	t.after(() => closeServer(server));
	const invalid = await fetch(`${baseUrl}/v1/responses`, {
		method: "POST",
		headers: {
			authorization: "Bearer local-test-key",
			"content-type": "application/json",
		},
		body: "{",
	});
	assert.equal(invalid.status, 400);
	assert.equal((await invalid.json()).error.code, "invalid_json");
	const failed = await fetch(`${baseUrl}/v1/responses`, {
		method: "POST",
		headers: {
			authorization: "Bearer local-test-key",
			"content-type": "application/json",
		},
		body: JSON.stringify({ model: "fake/model", input: "Hi" }),
	});
	assert.equal(failed.status, 502);
	const text = await failed.text();
	assert.doesNotMatch(text, /raw-upstream-secret-detail/);
	assert.equal(JSON.parse(text).error.code, "provider_error");
});

test("client disconnect aborts the provider signal", async (t) => {
	let markAborted;
	const aborted = new Promise((resolve) => {
		markAborted = resolve;
	});
	const runtime = fakeRuntime({
		stream(_model, _context, options) {
			return (async function* () {
				options.signal.addEventListener("abort", markAborted, { once: true });
				await new Promise((resolve) => options.signal.addEventListener("abort", resolve, { once: true }));
			})();
		},
	});
	const { server, baseUrl } = await started(runtime);
	t.after(() => closeServer(server));
	const url = new URL("/v1/responses", baseUrl);
	const request = http.request(url, {
		method: "POST",
		headers: {
			authorization: "Bearer local-test-key",
			"content-type": "application/json",
		},
	});
	request.end(JSON.stringify({ model: "fake/model", input: "Hi", stream: true }));
	await new Promise((resolve, reject) => {
		request.once("response", (response) => {
			response.once("data", () => {
				response.destroy();
				resolve();
			});
		});
		request.once("error", reject);
	});
	await Promise.race([
		aborted,
		new Promise((_, reject) => setTimeout(() => reject(new Error("abort timeout")), 1000)),
	]);
});

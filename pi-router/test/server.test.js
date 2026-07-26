import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";

import { createPiRouterServer, listenPiRouter, validateListenHost } from "../src/server.js";
import { addressUrl, closeServer, fakeRuntime, textStream } from "./helpers.js";

async function started(runtime = fakeRuntime(), options = {}) {
	const server = createPiRouterServer({
		runtime,
		apiKey: "local-test-key",
		now: () => 1000,
		...options,
	});
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
	assert.deepEqual(await health.json(), { status: "ok", service: "pi-router", version: "0.2.0" });
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

test("Management API is authenticated, bounded, and delegates exact update actions", async (t) => {
	const calls = [];
	const updater = {
		async status() {
			calls.push(["status"]);
			return {
				repository: "owner/repository",
				channel: "stable",
				automatic: false,
				install_supported: true,
				rollback_available: true,
				restart_required: false,
				pending_version: null,
			};
		},
		async check() {
			calls.push(["check"]);
			return { status: "available", latest_version: "0.3.0" };
		},
		async install(version) {
			calls.push(["install", version]);
			return { status: "installed", version, restart_required: true };
		},
		async rollback() {
			calls.push(["rollback"]);
			return { status: "rolled_back", restart_required: true };
		},
	};
	const { server, baseUrl } = await started(fakeRuntime(), {
		account: "work",
		updater,
	});
	t.after(() => closeServer(server));

	const unauthenticated = await fetch(`${baseUrl}/management/api/status`);
	assert.equal(unauthenticated.status, 401);
	assert.equal(calls.length, 0);

	const headers = { authorization: "Bearer local-test-key" };
	const status = await fetch(`${baseUrl}/management/api/status`, { headers });
	assert.equal(status.status, 200);
	const statusBody = await status.json();
	assert.equal(statusBody.object, "pi_router.management_status");
	assert.deepEqual(statusBody.service, {
		name: "pi-router",
		version: "0.2.0",
		status: "ok",
		uptime_seconds: 0,
	});
	assert.deepEqual(statusBody.account, { id: "work", available_models: 1 });
	assert.equal(statusBody.runtime.mode, "source");
	assert.equal(statusBody.update.repository, "owner/repository");
	assert.doesNotMatch(JSON.stringify(statusBody), /auth\.json|models\.json|local-test-key/);

	const checked = await fetch(`${baseUrl}/management/api/updates/check`, {
		method: "POST",
		headers,
	});
	assert.deepEqual(await checked.json(), { status: "available", latest_version: "0.3.0" });

	const installed = await fetch(`${baseUrl}/management/api/updates/install`, {
		method: "POST",
		headers: { ...headers, "content-type": "application/json" },
		body: JSON.stringify({ version: "0.3.0" }),
	});
	assert.deepEqual(await installed.json(), {
		status: "installed",
		version: "0.3.0",
		restart_required: true,
	});

	const rolledBack = await fetch(`${baseUrl}/management/api/updates/rollback`, {
		method: "POST",
		headers,
	});
	assert.deepEqual(await rolledBack.json(), {
		status: "rolled_back",
		restart_required: true,
	});
	assert.deepEqual(calls, [
		["status"],
		["check"],
		["install", "0.3.0"],
		["rollback"],
	]);
});

test("management UI is self-contained, unauthenticated, and browser-hardened", async (t) => {
	let modelReads = 0;
	const runtime = fakeRuntime();
	const originalListModels = runtime.listModels;
	runtime.listModels = async () => {
		modelReads += 1;
		return originalListModels();
	};
	const { server, baseUrl } = await started(runtime);
	t.after(() => closeServer(server));

	for (const path of ["/", "/management.html"]) {
		const response = await fetch(`${baseUrl}${path}`);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type"), /^text\/html; charset=utf-8$/);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		assert.equal(response.headers.get("x-frame-options"), "DENY");
		const csp = response.headers.get("content-security-policy");
		assert.match(csp, /default-src 'none'/);
		assert.match(csp, /script-src 'sha256-/);
		assert.match(csp, /style-src 'sha256-/);
		assert.doesNotMatch(csp, /unsafe-inline/);
		const body = await response.text();
		assert.match(body, /<title>Pi Router · Management Center<\/title>/);
		assert.match(body, /data-pi-router-ui/);
		assert.match(body, /management-center/);
		assert.match(body, /\/management\/api\/status/);
		assert.doesNotMatch(body, /<script[^>]+src=/);
		assert.doesNotMatch(body, /<link[^>]+href=/);
		assert.doesNotMatch(body, /localStorage|sessionStorage|indexedDB|document\.cookie/);
		assert.doesNotMatch(body, /local-test-key/);
		for (const tag of ["script", "style"]) {
			const opening = `<${tag}>`;
			const source = body.slice(
				body.indexOf(opening) + opening.length,
				body.indexOf(`</${tag}>`),
			);
			const hash = createHash("sha256").update(source).digest("base64");
			assert.ok(csp.includes(`${tag}-src 'sha256-${hash}'`));
		}
	}
	const head = await fetch(`${baseUrl}/management.html`, { method: "HEAD" });
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
	assert.equal(modelReads, 0);
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

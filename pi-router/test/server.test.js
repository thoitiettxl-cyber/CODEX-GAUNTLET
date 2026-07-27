import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProxyKeyStore } from "../src/proxy-keys.js";
import { createPiRouterServer, listenPiRouter, validateListenHost } from "../src/server.js";
import {
	addressUrl,
	closeServer,
	fakeProxyKeyStore,
	fakeRuntime,
	textStream,
} from "./helpers.js";

async function started(runtime = fakeRuntime(), options = {}) {
	const server = createPiRouterServer({
		runtime,
		managementKey: "management-test-key",
		proxyKeyStore: fakeProxyKeyStore(),
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
	assert.throws(
		() => createPiRouterServer({
			runtime: fakeRuntime(),
			managementKey: "local-test-key",
			proxyKeyStore: fakeProxyKeyStore(),
		}),
		(error) => error.code === "management_proxy_key_collision",
	);
});

test("health is bounded and v1 endpoints require bearer authentication", async (t) => {
	const { server, baseUrl } = await started();
	t.after(() => closeServer(server));
	const health = await fetch(`${baseUrl}/health`);
	assert.equal(health.status, 200);
	assert.deepEqual(await health.json(), { status: "ok", service: "pi-router", version: "0.4.0" });
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
	const managementKeyOnInference = await fetch(`${baseUrl}/v1/models`, {
		headers: { authorization: "Bearer management-test-key" },
	});
	assert.equal(managementKeyOnInference.status, 401);
	const proxyKeyOnManagement = await fetch(`${baseUrl}/management/api/status`, {
		headers: { authorization: "Bearer local-test-key" },
	});
	assert.equal(proxyKeyOnManagement.status, 401);
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

	const headers = { authorization: "Bearer management-test-key" };
	const status = await fetch(`${baseUrl}/management/api/status`, { headers });
	assert.equal(status.status, 200);
	const statusBody = await status.json();
	assert.equal(statusBody.object, "pi_router.management_status");
	assert.deepEqual(statusBody.service, {
		name: "pi-router",
		version: "0.4.0",
		status: "ok",
		uptime_seconds: 0,
	});
	assert.deepEqual(statusBody.account, {
		id: "work",
		providers: 1,
		configured_providers: 1,
		stored_credentials: 0,
		available_models: 1,
	});
	assert.equal(statusBody.runtime.mode, "source");
	assert.equal(statusBody.update.repository, "owner/repository");
	assert.deepEqual(statusBody.connection, {
		status: "connected",
		management_authenticated: true,
	});
	assert.deepEqual(statusBody.authentication, {
		management_key_configured: true,
		proxy_api_keys: 1,
	});
	assert.deepEqual(statusBody.quota, {
		supported_providers: 0,
		total_providers: 1,
		supported_credentials: 0,
		total_credentials: 0,
	});
	assert.equal(statusBody.config.supported, false);
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

test("proxy API-key Management API discloses values once and changes only inference auth", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-proxy-api-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const proxyKeyStore = await ProxyKeyStore.open({
		path: join(root, "proxy-api-keys.json"),
		seedKey: "seed-proxy-key",
		requireKey: true,
	});
	const { server, baseUrl } = await started(fakeRuntime(), { proxyKeyStore });
	t.after(() => closeServer(server));
	const headers = {
		authorization: "Bearer management-test-key",
		"content-type": "application/json",
	};

	const initial = await fetch(`${baseUrl}/management/api/proxy-keys`, { headers })
		.then((response) => response.json());
	assert.equal(initial.data.length, 1);
	assert.equal(Object.hasOwn(initial.data[0], "value"), false);
	const created = await fetch(`${baseUrl}/management/api/proxy-keys`, {
		method: "POST",
		headers,
		body: JSON.stringify({ label: "Second client" }),
	}).then((response) => response.json());
	assert.match(created.value, /^prk_/u);
	assert.equal(
		(await fetch(`${baseUrl}/v1/models`, {
			headers: { authorization: `Bearer ${created.value}` },
		})).status,
		200,
	);

	const updated = await fetch(
		`${baseUrl}/management/api/proxy-keys/${created.id}`,
		{
			method: "PATCH",
			headers,
			body: JSON.stringify({ label: "Renamed client" }),
		},
	).then((response) => response.json());
	assert.equal(updated.label, "Renamed client");
	assert.equal(Object.hasOwn(updated, "value"), false);

	const replaced = await fetch(
		`${baseUrl}/management/api/proxy-keys/${created.id}/replace`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({}),
		},
	).then((response) => response.json());
	assert.notEqual(replaced.value, created.value);
	assert.equal(
		(await fetch(`${baseUrl}/v1/models`, {
			headers: { authorization: `Bearer ${created.value}` },
		})).status,
		401,
	);
	assert.equal(
		(await fetch(`${baseUrl}/v1/models`, {
			headers: { authorization: `Bearer ${replaced.value}` },
		})).status,
		200,
	);

	const removedSeed = await fetch(
		`${baseUrl}/management/api/proxy-keys/${initial.data[0].id}`,
		{ method: "DELETE", headers },
	);
	assert.equal(removedSeed.status, 200);
	const lastRemoval = await fetch(
		`${baseUrl}/management/api/proxy-keys/${created.id}`,
		{ method: "DELETE", headers },
	);
	assert.equal(lastRemoval.status, 409);
	assert.equal((await lastRemoval.json()).error.code, "last_proxy_key");

	const events = await fetch(`${baseUrl}/management/api/events?limit=100`, { headers })
		.then((response) => response.text());
	assert.match(events, /management\.proxy_keys/u);
	assert.doesNotMatch(
		events,
		new RegExp(`${created.value}|${replaced.value}|management-test-key`, "u"),
	);
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
		assert.match(csp, /script-src-attr 'none'/);
		assert.match(csp, /style-src 'sha256-/);
		assert.match(csp, /style-src-attr 'none'/);
		assert.doesNotMatch(csp, /unsafe-inline/);
		const body = await response.text();
		assert.match(body, /<title>Pi Router · Management Center<\/title>/);
		assert.match(body, /data-pi-router-ui/);
		assert.match(body, /management-center/);
		assert.match(body, /\/management\/api\/status/);
		for (const label of [
			"Dashboard",
			"AI Providers",
			"Auth Files",
			"OAuth Login",
			"Quota Management",
			"Logs Viewer",
			"Config Panel",
		]) {
			assert.match(body, new RegExp(label));
		}
		assert.match(body, /href="#main-content">Skip to main content/);
		assert.match(body, /aria-controls":"primary-navigation"/);
		assert.match(body, /prefers-reduced-motion/);
		assert.match(body, /max-width:680px/);
		assert.match(body, /PI_ROUTER_MANAGEMENT_KEY/);
		assert.match(body, /Proxy API keys/);
		assert.match(body, /Custom OpenAI-compatible provider/);
		assert.match(body, /Target account/);
		assert.match(body, /credential-scoped/);
		assert.doesNotMatch(body, /Responses workbench|Compose a probe/);
		assert.doesNotMatch(body, /<script[^>]+src=/);
		assert.doesNotMatch(body, /<link[^>]+href=/);
		assert.doesNotMatch(body, /style="/);
		assert.doesNotMatch(body, /localStorage|sessionStorage|indexedDB|document\.cookie/);
		assert.doesNotMatch(body, /local-test-key|management-test-key/);
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

test("operations APIs cover provider, auth, quota, events, and atomic config workflows", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-operations-api-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const modelsPath = join(root, "models.json");
	const initial = {
		providers: {
			fake: {
				name: "Fake Provider",
				baseUrl: "https://api.example.test/v1",
				api: "openai-responses",
				headers: { "User-Agent": "pi-router" },
				models: [{ id: "model", name: "Fake Model" }],
			},
		},
	};
	await writeFile(modelsPath, `${JSON.stringify(initial, null, 2)}\n`);
	let promptResponse;
	const runtime = fakeRuntime({
		credentials: [{
			id: "cred_fake",
			account_id: "default",
			account_label: "Default",
			provider_id: "fake",
			provider_name: "Fake Provider",
			type: "oauth",
			label: "Fake OAuth",
			active: true,
		}],
		async login(_provider, _type, interaction) {
			interaction.notify({
				type: "auth_url",
				url: "https://example.test/login?state=transient",
				instructions: "Sign in",
			});
			promptResponse = await interaction.prompt({
				type: "secret",
				message: "API key",
			});
		},
	});
	const { server, baseUrl } = await started(runtime, {
		modelsPath,
		quotaAdapters: new Map([["fake", {
			async fetch() {
				return {
					windows: [{ label: "Monthly", unit: "requests", used: 2, limit: 10 }],
				};
			},
		}]]),
	});
	t.after(() => closeServer(server));
	const headers = {
		authorization: "Bearer management-test-key",
		"content-type": "application/json",
	};

	const providers = await fetch(`${baseUrl}/management/api/providers`, { headers });
	assert.equal(providers.status, 200);
	assert.equal((await providers.json()).data[0].name, "Fake Provider");
	const credentials = await fetch(`${baseUrl}/management/api/credentials`, { headers });
	const credentialText = await credentials.text();
	assert.match(credentialText, /"provider_id":"fake"/);
	assert.doesNotMatch(credentialText, /auth\\.json|api[_-]?key.*value/i);

	const createdResponse = await fetch(`${baseUrl}/management/api/auth/sessions`, {
		method: "POST",
		headers,
		body: JSON.stringify({ provider_id: "fake", type: "api_key" }),
	});
	assert.equal(createdResponse.status, 201);
	const created = await createdResponse.json();
	assert.equal(created.state, "waiting_for_input");
	assert.equal(created.prompt.type, "secret");
	assert.equal(created.events[0].type, "auth_url");
	const submittedResponse = await fetch(
		`${baseUrl}/management/api/auth/sessions/${created.id}/respond`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				prompt_id: created.prompt.id,
				value: "must-never-be-returned",
			}),
		},
	);
	const submittedText = await submittedResponse.text();
	assert.doesNotMatch(submittedText, /must-never-be-returned/);
	await new Promise((resolve) => setImmediate(resolve));
	const completed = await fetch(
		`${baseUrl}/management/api/auth/sessions/${created.id}`,
		{ headers },
	).then((response) => response.json());
	assert.equal(completed.state, "completed");
	assert.equal(promptResponse, "must-never-be-returned");

	const quota = await fetch(`${baseUrl}/management/api/quota`, { headers })
		.then((response) => response.json());
	assert.equal(quota.data[0].status, "available");
	assert.equal(quota.data[0].windows[0].remaining, 8);

	const config = await fetch(`${baseUrl}/management/api/config`, { headers })
		.then((response) => response.json());
	assert.equal(config.editable, true);
	const candidate = structuredClone(initial);
	candidate.providers.fake.models.push({ id: "second", name: "Second" });
	const preview = await fetch(`${baseUrl}/management/api/config/preview`, {
		method: "POST",
		headers,
		body: JSON.stringify({ document: candidate }),
	}).then((response) => response.json());
	assert.equal(preview.valid, true);
	assert.equal(preview.changed, true);
	const applied = await fetch(`${baseUrl}/management/api/config/apply`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			document: candidate,
			expected_revision: preview.revision,
		}),
	}).then((response) => response.json());
	assert.equal(applied.status, "applied");
	const restored = await fetch(`${baseUrl}/management/api/config/restore`, {
		method: "POST",
		headers,
		body: JSON.stringify({ expected_revision: applied.revision }),
	}).then((response) => response.json());
	assert.equal(restored.status, "restored");

	const removed = await fetch(`${baseUrl}/management/api/credentials/fake`, {
		method: "DELETE",
		headers,
	}).then((response) => response.json());
	assert.equal(removed.status, "removed");
	const eventsResponse = await fetch(`${baseUrl}/management/api/events?limit=100`, { headers });
	const eventsText = await eventsResponse.text();
	assert.match(eventsText, /management\.auth/);
	assert.match(eventsText, /management\.config/);
	assert.doesNotMatch(
		eventsText,
		/must-never-be-returned|Bearer (?:local|management)-test-key|models\\.json/,
	);

	const badLimit = await fetch(`${baseUrl}/management/api/events?limit=999`, { headers });
	assert.equal(badLimit.status, 400);
	const missingSession = await fetch(
		`${baseUrl}/management/api/auth/sessions/00000000-0000-0000-0000-000000000000`,
		{ headers },
	);
	assert.equal(missingSession.status, 404);
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

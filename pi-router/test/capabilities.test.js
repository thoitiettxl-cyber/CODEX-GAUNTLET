import assert from "node:assert/strict";
import { once } from "node:events";
import {
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AccountRuntimePool } from "../src/accounts.js";
import { ConfigService } from "../src/management/config.js";
import { validateConfigDocument } from "../src/management/config-policy.js";
import { createQuotaService } from "../src/management/quota.js";
import { createDefaultQuotaAdapters } from "../src/management/quota-adapters/index.js";
import { statePaths } from "../src/paths.js";
import { PiRuntime } from "../src/pi-runtime.js";
import { ProviderPolicy } from "../src/provider-policy.js";
import { withProviderProxy } from "../src/provider-proxy.js";
import { createAntigravityProviderConfig } from "../src/providers/antigravity-oauth.js";
import { ProxyKeyStore } from "../src/proxy-keys.js";

const PROVIDER = {
	id: "openai-codex",
	name: "OpenAI Codex",
	auth_modes: [{ type: "oauth", login_supported: true }],
	configured: false,
	configured_source: undefined,
	credential_type: undefined,
	model_count: 1,
	available_model_count: 0,
	state: "unconfigured",
};

test("proxy API-key storage migrates once, persists only digests, and protects the last key", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-proxy-keys-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "proxy-api-keys.json");
	const legacy = "legacy-proxy-value";
	const store = await ProxyKeyStore.open({ path, seedKey: legacy, requireKey: true });

	assert.equal(store.authorize(legacy), true);
	assert.equal(store.count(), 1);
	const seed = store.list().data[0];
	assert.equal(seed.label, "Migrated PI_ROUTER_API_KEY");
	assert.equal(Object.hasOwn(seed, "value"), false);
	assert.equal((await stat(path)).mode & 0o777, 0o600);
	assert.doesNotMatch(await readFile(path, "utf8"), /legacy-proxy-value/);

	const created = await store.create({ label: "Automation" });
	assert.match(created.value, /^prk_[A-Za-z0-9_-]{43}$/u);
	assert.equal(store.authorize(created.value), true);
	assert.equal(Object.hasOwn(store.list().data[1], "value"), false);
	await store.remove(seed.id);

	const oldValue = created.value;
	const replaced = await store.replace(created.id);
	assert.notEqual(replaced.value, oldValue);
	assert.equal(store.authorize(oldValue), false);
	assert.equal(store.authorize(replaced.value), true);
	await assert.rejects(
		store.remove(created.id),
		(error) => error.code === "last_proxy_key",
	);

	const reopened = await ProxyKeyStore.open({
		path,
		seedKey: "must-not-become-an-implicit-key",
		requireKey: true,
	});
	assert.equal(reopened.authorize(replaced.value), true);
	assert.equal(reopened.authorize("must-not-become-an-implicit-key"), false);
	assert.doesNotMatch(await readFile(path, "utf8"), new RegExp(replaced.value, "u"));
});

test("same-provider logins use isolated accounts and receive unique identity labels", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-accounts-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = statePaths({ stateDir: root, accountId: "default" });
	const runtimes = new Map();
	const runtimeFor = (accountId) => {
		const credentials = [];
		const runtime = {
			accountId,
			async listModels() {
				return [];
			},
			async listProviderMetadata() {
				return [{
					...PROVIDER,
					configured: credentials.length > 0,
					credential_type: credentials[0]?.type,
				}];
			},
			async listCredentialMetadata() {
				return credentials.map((credential) => ({
					provider_id: "openai-codex",
					provider_name: "OpenAI Codex",
					type: credential.type,
				}));
			},
			async login(_providerId, type) {
				credentials.splice(0, credentials.length, { type });
				return {
					type,
					email: "same-user@example.test",
					access: `oauth-secret-for-${accountId}`,
					accountId: `upstream-${accountId}`,
				};
			},
			async logout() {
				credentials.length = 0;
			},
			async resolveAuth() {
				return { auth: { apiKey: `resolved-${accountId}` } };
			},
			async refreshConfiguration() {},
		};
		runtimes.set(accountId, runtime);
		return runtime;
	};
	const activeRuntime = runtimeFor("default");
	const pool = await AccountRuntimePool.create({
		paths,
		activeRuntime,
		createRuntime: async ({ authPath }) =>
			runtimeFor(authPath.split("/").at(-2)),
		id: (() => {
			const values = [
				"10000000-0000-4000-8000-000000000001",
				"20000000-0000-4000-8000-000000000002",
			];
			return () => values.shift();
		})(),
	});

	const firstTarget = await pool.prepareLogin({ providerId: "openai-codex" });
	const first = await pool.login("openai-codex", "oauth", {}, {
		accountId: firstTarget.account_id,
	});
	const secondTarget = await pool.prepareLogin({ providerId: "openai-codex" });
	const second = await pool.login("openai-codex", "oauth", {}, {
		accountId: secondTarget.account_id,
	});

	assert.notEqual(first.account_id, second.account_id);
	assert.notEqual(first.id, second.id);
	assert.equal(first.label, "same-user@example.test");
	assert.equal(second.label, "same-user@example.test (2)");
	assert.equal(first.account_label, "same-user@example.test");
	assert.equal(second.account_label, "same-user@example.test (2)");
	assert.equal(first.active, false);
	assert.equal(second.active, false);
	const credentials = await pool.listCredentialMetadata();
	assert.deepEqual(
		credentials.map((credential) => credential.label).sort(),
		["same-user@example.test", "same-user@example.test (2)"],
	);
	assert.equal((await pool.listProviderMetadata())[0].credential_count, 2);
	const catalogBeforeRead = await readFile(paths.accountCatalogPath, "utf8");
	await pool.listCredentialMetadata();
	assert.equal(await readFile(paths.accountCatalogPath, "utf8"), catalogBeforeRead);

	const contexts = await pool.quotaCredentialContexts();
	assert.equal(contexts.length, 2);
	assert.deepEqual(
		await Promise.all(contexts.map((context) => context.resolveAuth())),
		[
			{ auth: { apiKey: `resolved-${first.account_id}` } },
			{ auth: { apiKey: `resolved-${second.account_id}` } },
		],
	);
	const catalog = await readFile(paths.accountCatalogPath, "utf8");
	assert.doesNotMatch(catalog, /oauth-secret-for-|resolved-/u);
	await runtimes.get(first.account_id).logout();
	assert.deepEqual(
		(await pool.listCredentialMetadata()).map((credential) => credential.id),
		[second.id],
	);
});

test("raw auth files import into new isolated accounts and export exact source bytes", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-auth-files-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = statePaths({ stateDir: root, accountId: "default" });
	const runtimeFor = (authPath) => {
		let stored = {};
		return {
			async listModels() {
				return [];
			},
			async listProviderMetadata() {
				return Object.keys(stored).map((providerId) => ({
					...PROVIDER,
					id: providerId,
					name: providerId,
					configured: true,
					credential_type: stored[providerId].type,
				}));
			},
			async listCredentialMetadata() {
				return Object.entries(stored).map(([providerId, credential]) => ({
					provider_id: providerId,
					provider_name: providerId,
					type: credential.type,
				}));
			},
			async reloadCredentials() {
				try {
					stored = JSON.parse(await readFile(authPath, "utf8"));
				} catch (error) {
					if (error?.code !== "ENOENT") {
						throw error;
					}
				}
			},
			async refreshConfiguration() {},
		};
	};
	const activeRuntime = runtimeFor(paths.authPath);
	const pool = await AccountRuntimePool.create({
		paths,
		activeRuntime,
		createRuntime: async ({ authPath }) => runtimeFor(authPath),
		id: (() => {
			let index = 0;
			return () => `${String(++index).padStart(8, "0")}-0000-4000-8000-000000000000`;
		})(),
	});
	const source = [
		"{",
		"  \"openai-codex\": {",
		"    \"type\": \"oauth\",",
		"    \"access\": \"test-secret-token\"",
		"  }",
		"}",
		"",
	].join("\n");
	const first = await pool.importAuthFile(source);
	assert.equal(first.status, "imported");
	assert.notEqual(first.account_id, "default");
	assert.equal(first.credentials.length, 1);
	const exported = await pool.exportAuthFile(first.credentials[0].id);
	assert.equal(exported.source.toString("utf8"), source);
	assert.equal((await stat(join(root, "accounts", first.account_id, "auth.json"))).mode & 0o777, 0o600);

	const second = await pool.importAuthFile(source);
	assert.notEqual(second.account_id, first.account_id);
	assert.notEqual(second.credentials[0].id, first.credentials[0].id);
	assert.equal((await pool.listCredentialMetadata()).length, 2);
	await assert.rejects(
		pool.importAuthFile("{not-json"),
		(error) => error.code === "credential_file_invalid",
	);
	assert.equal((await pool.listCredentialMetadata()).length, 2);
	assert.doesNotMatch(
		await readFile(paths.accountCatalogPath, "utf8"),
		/test-secret-token/u,
	);
});

test("fixed quota adapters normalize Codex, Claude, Antigravity, Kimi, and xAI independently", async () => {
	const calls = [];
	const fetchImpl = async (url, options) => {
		calls.push({
			url: String(url),
			authorization: options.headers.authorization,
		});
		let payload;
		if (String(url).includes("/wham/usage")) {
			payload = {
				rate_limit: {
					primary_window: { used_percent: 20, reset_after_seconds: 60 },
				},
			};
		} else if (String(url).includes("anthropic.com/api/oauth/usage")) {
			payload = { five_hour: { utilization: 0.25, resets_at: "2026-08-01T00:00:00Z" } };
		} else if (String(url).includes("kimi.com/coding/v1/usages")) {
			payload = {
				limits: [{ detail: { name: "Kimi weekly", used: 12, limit: 100, reset_in: 60 } }],
			};
		} else if (String(url).includes("retrieveUserQuotaSummary")) {
			payload = {
				groups: [{
					displayName: "Gemini",
					buckets: [{
						displayName: "Pro",
						remainingFraction: "75%",
						resetTime: "2026-08-01T00:00:00Z",
					}],
				}],
			};
		} else if (String(url).includes("cli-chat-proxy.grok.com")) {
			payload = {
				config: {
					currentPeriod: { type: "xAI weekly", end: "2026-08-01T00:00:00Z" },
					creditUsagePercent: 30,
				},
			};
		} else {
			throw new Error(`Unexpected quota URL: ${url}`);
		}
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	const adapters = createDefaultQuotaAdapters({
		fetchImpl,
		now: () => Date.parse("2026-07-27T00:00:00Z"),
	});
	const providers = [
		"openai-codex",
		"anthropic",
		"antigravity",
		"kimi-coding",
		"xai",
	];
	for (const providerId of providers) {
		const result = await adapters.get(providerId).fetch({
			credential: {
				quota_metadata: { project_id: "project-test" },
				resolveAuth: async () => ({ auth: { apiKey: `token-${providerId}` } }),
			},
		});
		assert.ok(result.windows.length > 0, `${providerId} returned normalized windows`);
		assert.ok(result.windows.every((window) =>
			Number.isFinite(window.used) && Number.isFinite(window.limit)));
	}
	assert.equal(calls.some((call) => call.url.includes("example")), false);
	assert.ok(calls.every((call) => call.authorization.startsWith("Bearer token-")));
	assert.deepEqual(
		[...new Set(calls.map((call) => new URL(call.url).hostname))].sort(),
		[
			"api.anthropic.com",
			"api.kimi.com",
			"chatgpt.com",
			"cli-chat-proxy.grok.com",
			"daily-cloudcode-pa.googleapis.com",
		].sort(),
	);

	const oversized = createDefaultQuotaAdapters({
		fetchImpl: async () => new Response("{}", {
			status: 200,
			headers: { "content-length": String(300 * 1024) },
		}),
	}).get("openai-codex");
	await assert.rejects(
		oversized.fetch({
			credential: {
				resolveAuth: async () => ({ auth: { apiKey: "bounded-token" } }),
			},
		}),
		/too large/u,
	);
});

test("quota failures are isolated per exact OAuth credential", async () => {
	const credentialData = [
		{
			id: "cred_first",
			account_id: "first",
			account_label: "First",
			provider_id: "openai-codex",
			provider_name: "OpenAI Codex",
			type: "oauth",
			label: "First credential",
			active: true,
		},
		{
			id: "cred_second",
			account_id: "second",
			account_label: "Second",
			provider_id: "openai-codex",
			provider_name: "OpenAI Codex",
			type: "oauth",
			label: "Second credential",
			active: false,
		},
	];
	const service = createQuotaService({
		providers: {
			async list() {
				return { object: "list", data: [PROVIDER] };
			},
		},
		credentials: {
			async list() {
				return { object: "list", data: credentialData };
			},
		},
		runtime: {
			async quotaCredentialContexts() {
				return credentialData.map((credential) => ({
					...credential,
					resolveAuth: async () => ({ auth: { apiKey: credential.id } }),
				}));
			},
		},
		adapters: new Map([["openai-codex", {
			async fetch({ credential }) {
				if (credential.id === "cred_second") {
					throw new Error("credential-specific raw failure");
				}
				return {
					windows: [{ label: "Codex", unit: "percent", used: 10, limit: 100 }],
				};
			},
		}]]),
		now: () => 1000,
	});
	assert.deepEqual(await service.summary(), {
		supported_providers: 1,
		total_providers: 1,
		supported_credentials: 2,
		total_credentials: 2,
	});
	const result = await service.list();
	assert.equal(result.data[0].credential_id, "cred_first");
	assert.equal(result.data[0].status, "available");
	assert.equal(result.data[1].credential_id, "cred_second");
	assert.equal(result.data[1].status, "error");
	assert.doesNotMatch(JSON.stringify(result), /credential-specific raw failure/u);
});

test("custom providers split Pi configuration from aliases, exclusions, and proxy policy", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-provider-policy-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const modelsPath = join(root, "models.json");
	const policyPath = join(root, "provider-policy.json");
	await writeFile(modelsPath, `${JSON.stringify({ providers: {} }, null, 2)}\n`);
	const config = new ConfigService({
		modelsPath,
		providerPolicyPath: policyPath,
		runtime: { async refreshConfiguration() {} },
	});
	const current = await config.get();
	const candidate = {
		providers: {
			"my-openai": {
				name: "My OpenAI",
				baseUrl: "https://api.example.test/v1",
				api: "openai-completions",
				authHeader: true,
				headers: { "X-Client-Name": "pi-router" },
				proxyUrl: "http://127.0.0.1:9080",
				modelAliases: { "upstream-model": "friendly" },
				excludedModels: ["*-preview"],
				models: [
					{ id: "upstream-model", name: "Upstream" },
					{ id: "old-preview", name: "Old preview" },
				],
			},
		},
	};
	const preview = await config.preview({ document: candidate });
	assert.equal(preview.valid, true);
	assert.equal(preview.revision, current.revision);
	const applied = await config.apply({
		document: candidate,
		expected_revision: preview.revision,
	});
	assert.equal(applied.status, "applied");

	const piDocument = JSON.parse(await readFile(modelsPath, "utf8"));
	assert.equal(piDocument.providers["my-openai"].baseUrl, "https://api.example.test/v1");
	assert.equal(Object.hasOwn(piDocument.providers["my-openai"], "proxyUrl"), false);
	assert.equal(Object.hasOwn(piDocument.providers["my-openai"], "modelAliases"), false);
	assert.equal(Object.hasOwn(piDocument.providers["my-openai"], "excludedModels"), false);
	const policyDocument = JSON.parse(await readFile(policyPath, "utf8"));
	assert.deepEqual(policyDocument.providers["my-openai"], {
		proxyUrl: "http://127.0.0.1:9080",
		modelAliases: { "upstream-model": "friendly" },
		excludedModels: ["*-preview"],
	});
	assert.equal((await stat(policyPath)).mode & 0o777, 0o600);
	assert.deepEqual((await config.get()).document, candidate);

	const policy = await ProviderPolicy.open({ path: policyPath });
	const original = {
		provider: "my-openai",
		id: "upstream-model",
		name: "Upstream",
		api: "openai-completions",
	};
	const exposed = policy.apply([
		original,
		{ ...original, id: "old-preview", name: "Old preview" },
	]);
	assert.deepEqual(exposed.map((model) => model.id), ["friendly"]);
	assert.equal(policy.unwrap(exposed[0]), original);
	assert.equal(policy.proxyUrl("my-openai"), "http://127.0.0.1:9080");

	let captured;
	const runtime = new PiRuntime({
		streamSimple(model, context, options) {
			captured = { model, context, options };
			return "stream";
		},
	}, { providerPolicy: policy });
	assert.equal(runtime.stream(exposed[0], { messages: [] }, {}), "stream");
	assert.equal(captured.model, original);
	assert.equal(captured.options.env.HTTP_PROXY, "http://127.0.0.1:9080");
	assert.equal(captured.options.env.HTTPS_PROXY, "http://127.0.0.1:9080");
	await writeFile(policyPath, JSON.stringify({
		version: 1,
		providers: {
			"my-openai": {
				proxyUrl: "http://user:password@127.0.0.1:9080",
			},
		},
	}));
	await assert.rejects(
		ProviderPolicy.open({ path: policyPath }),
		(error) => error.code === "provider_policy_invalid",
	);

	const invalid = validateConfigDocument({
		providers: {
			custom: {
				baseUrl: "https://api.example.test/v1",
				headers: { Authorization: "must-not-cross-management" },
				proxyUrl: "http://127.0.0.1:9080?secret=value",
			},
		},
	});
	assert.equal(invalid.valid, false);
	assert.doesNotMatch(JSON.stringify(invalid), /must-not-cross-management|secret=value/u);
});

function trackedServer(server) {
	const sockets = new Set();
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	return {
		server,
		async close() {
			for (const socket of sockets) {
				socket.destroy();
			}
			if (!server.listening) {
				return;
			}
			server.close();
			await once(server, "close");
		},
	};
}

async function startProxy() {
	let connects = 0;
	const tracked = trackedServer(http.createServer());
	tracked.server.on("connect", (request, client, head) => {
		connects += 1;
		const [hostname, rawPort] = request.url.split(":");
		const upstream = net.connect(Number(rawPort), hostname, () => {
			client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			if (head.length > 0) {
				upstream.write(head);
			}
			upstream.pipe(client);
			client.pipe(upstream);
		});
		upstream.once("error", () => client.destroy());
	});
	tracked.server.listen(0, "127.0.0.1");
	await once(tracked.server, "listening");
	return {
		...tracked,
		get connects() {
			return connects;
		},
		url: `http://127.0.0.1:${tracked.server.address().port}`,
	};
}

test("provider proxy dispatch stays scoped across concurrent requests", async (t) => {
	const target = trackedServer(http.createServer((_request, response) => {
		response.end("target");
	}));
	target.server.listen(0, "127.0.0.1");
	await once(target.server, "listening");
	const firstProxy = await startProxy();
	const secondProxy = await startProxy();
	t.after(() => Promise.all([
		firstProxy.close(),
		secondProxy.close(),
		target.close(),
	]));
	const targetUrl = `http://127.0.0.1:${target.server.address().port}`;

	assert.equal(await fetch(targetUrl).then((response) => response.text()), "target");
	assert.deepEqual(
		await Promise.all([
			withProviderProxy(firstProxy.url, async () => {
				await Promise.resolve();
				return fetch(targetUrl).then((response) => response.text());
			}),
			withProviderProxy(secondProxy.url, async () => {
				await new Promise((resolve) => setImmediate(resolve));
				return fetch(targetUrl).then((response) => response.text());
			}),
		]),
		["target", "target"],
	);
	assert.equal(firstProxy.connects, 1);
	assert.equal(secondProxy.connects, 1);

	const deferredFetch = () => (async function* deferredStream() {
		await Promise.resolve();
		yield await fetch(targetUrl).then((response) => response.text());
	})();
	const consume = async (stream) => {
		const values = [];
		for await (const value of stream) {
			values.push(value);
		}
		return values;
	};
	assert.deepEqual(
		await Promise.all([
			consume(withProviderProxy(firstProxy.url, deferredFetch)),
			consume(withProviderProxy(secondProxy.url, deferredFetch)),
		]),
		[["target"], ["target"]],
	);
	assert.equal(firstProxy.connects, 2);
	assert.equal(secondProxy.connects, 2);
});

test("Antigravity OAuth is opt-in and derives account identity without browser secrets", async () => {
	assert.equal(createAntigravityProviderConfig(), undefined);
	let authUrl;
	const requests = [];
	const provider = createAntigravityProviderConfig({
		clientId: "test-client-id",
		clientSecret: "test-client-secret",
		fetchImpl: async (url, options = {}) => {
			requests.push(String(url));
			if (String(url).includes("oauth2.googleapis.com/token")) {
				return new Response(JSON.stringify({
					access_token: "test-access",
					refresh_token: "test-refresh",
					expires_in: 3600,
				}), { status: 200 });
			}
			if (String(url).includes("userinfo")) {
				return new Response(JSON.stringify({ email: "antigravity@example.test" }), {
					status: 200,
				});
			}
			if (String(url).includes("loadCodeAssist")) {
				return new Response(JSON.stringify({
					cloudaicompanionProject: "test-project",
				}), { status: 200 });
			}
			throw new Error(`Unexpected Antigravity URL: ${url}; ${options.method}`);
		},
	});
	const credential = await provider.oauth.login({
		signal: new AbortController().signal,
		onAuth(info) {
			authUrl = info.url;
		},
		onProgress() {},
		async onManualCodeInput() {
			await Promise.resolve();
			const state = new URL(authUrl).searchParams.get("state");
			return `http://localhost:51121/oauth-callback?code=test-code&state=${state}`;
		},
	});
	assert.equal(credential.email, "antigravity@example.test");
	assert.equal(credential.projectId, "test-project");
	assert.equal(provider.oauth.getApiKey(credential), "test-access");
	assert.deepEqual(requests.map((url) => new URL(url).hostname), [
		"oauth2.googleapis.com",
		"www.googleapis.com",
		"cloudcode-pa.googleapis.com",
	]);
	assert.doesNotMatch(JSON.stringify({ authUrl, requests }), /test-client-secret|test-access/u);
});

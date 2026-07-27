import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthSessionService } from "../src/management/auth-sessions.js";
import { ConfigService } from "../src/management/config.js";
import {
	MAX_CONFIG_BYTES,
	validateConfigDocument,
} from "../src/management/config-policy.js";
import { createCredentialService } from "../src/management/credentials.js";
import { OperationalEventLog } from "../src/management/event-log.js";
import { createManagementService } from "../src/management/index.js";
import { ProviderMutationCoordinator } from "../src/management/mutations.js";
import { createProviderService } from "../src/management/providers.js";
import { createQuotaService } from "../src/management/quota.js";
import { RawConfigService } from "../src/management/raw-config.js";

const PROVIDER = Object.freeze({
	id: "fake",
	name: "Fake Provider",
	auth_modes: [
		{ type: "api_key", login_supported: true },
		{ type: "oauth", login_supported: true },
	],
	configured: true,
	configured_source: "stored",
	credential_type: "api_key",
	model_count: 2,
	available_model_count: 1,
	state: "available",
});

function providerRuntime(overrides = {}) {
	return {
		async listProviderMetadata() {
			return [PROVIDER];
		},
		async listCredentialMetadata() {
			return [{
				provider_id: "fake",
				provider_name: "Fake Provider",
				type: "api_key",
			}];
		},
		async logout() {},
		async login() {},
		async refreshConfiguration() {},
		...overrides,
	};
}

function immediate() {
	return new Promise((resolve) => setImmediate(resolve));
}

test("operational event log is fixed-shape, bounded, and newest-first", () => {
	let now = 1000;
	const events = new OperationalEventLog({ capacity: 2, now: () => now });
	assert.equal(events.classify("POST", "/v1/responses"), "responses");
	assert.equal(events.classify("GET", "/unexpected?secret=yes"), "not_found");
	events.record({
		requestClass: "responses",
		status: 200,
		durationMs: 12.6,
		model: "fake/model",
		provider: "fake",
		authorization: "Bearer must-not-appear",
		body: "private prompt",
	});
	now += 1000;
	events.record({
		requestClass: "management.providers",
		status: 503,
		durationMs: -1,
		errorCode: "provider_error",
	});
	now += 1000;
	events.record({
		requestClass: "unknown",
		status: 999,
		durationMs: 2,
		model: "../../secret",
		errorCode: "NOT SAFE",
	});
	const result = events.list(2);
	assert.equal(result.data.length, 2);
	assert.equal(result.data[0].request_class, "not_found");
	assert.equal(result.data[0].status, 500);
	assert.equal(result.data[0].model, undefined);
	assert.equal(result.data[1].error_code, "provider_error");
	assert.equal(result.data[1].duration_ms, 0);
	assert.deepEqual(events.summary(), {
		enabled: true,
		requests: 2,
		errors: 2,
		last_event_at: new Date(now).toISOString(),
		retention: "memory",
	});
	assert.doesNotMatch(JSON.stringify(result), /must-not-appear|private prompt/);
	assert.throws(() => events.list(0), /limit/);
});

test("provider and credential services normalize metadata and serialize logout", async () => {
	const calls = [];
	const runtime = providerRuntime({
		async listProviderMetadata() {
			return [
				PROVIDER,
				{
					id: "bad provider",
					name: "\u0000bad",
					auth_modes: [{ type: "password", login_supported: true }],
					state: "mystery",
				},
			];
		},
		async logout(provider) {
			calls.push(provider);
		},
	});
	const providers = createProviderService({ runtime });
	assert.deepEqual((await providers.list()).data, [{
		...PROVIDER,
		credential_count: 1,
		configuration_required: null,
	}]);
	const coordinator = new ProviderMutationCoordinator();
	const credentials = createCredentialService({ runtime, coordinator });
	assert.deepEqual((await credentials.list()).data, [{
		id: "fake",
		account_id: "default",
		account_label: "default",
		provider_id: "fake",
		provider_name: "Fake Provider",
		type: "api_key",
		label: "Fake Provider · default",
		active: true,
		created_at: null,
		updated_at: null,
	}]);
	assert.deepEqual(await credentials.remove("fake"), {
		object: "pi_router.credential_mutation",
		status: "removed",
		credential_id: "fake",
		account_id: "default",
		provider_id: "fake",
	});
	assert.deepEqual(calls, ["fake"]);
	const release = coordinator.acquire("default:fake");
	await assert.rejects(credentials.remove("fake"), (error) =>
		error.code === "provider_mutation_in_progress");
	release();
	await assert.rejects(
		credentials.remove("../fake"),
		(error) => error.code === "invalid_provider",
	);
});

test("auth sessions expose safe prompts and never echo the submitted secret", async () => {
	let receivedSecret;
	const runtime = providerRuntime({
		async login(_provider, _type, interaction) {
			interaction.notify({
				type: "info",
				message: "Prepare authentication",
				links: [{ url: "https://example.test/help", label: "Help" }],
			});
			interaction.notify({
				type: "auth_url",
				url: "https://example.test/oauth?state=transient",
				instructions: "Open the sign-in page",
			});
			receivedSecret = await interaction.prompt({
				type: "secret",
				message: "API key",
				placeholder: "sk-example",
			});
		},
	});
	const providers = createProviderService({ runtime });
	const coordinator = new ProviderMutationCoordinator();
	const sessions = new AuthSessionService({
		runtime,
		providers,
		coordinator,
		ttlMs: 60_000,
	});
	const created = await sessions.create({ provider_id: "fake", type: "api_key" });
	await immediate();
	const waiting = sessions.get(created.id);
	assert.equal(waiting.state, "waiting_for_input");
	assert.equal(waiting.prompt.type, "secret");
	assert.equal(waiting.prompt.placeholder, undefined);
	assert.equal(waiting.events[0].type, "info");
	assert.equal(waiting.events[1].type, "auth_url");
	assert.doesNotMatch(JSON.stringify(waiting), /sk-example/);
	const response = sessions.respond(created.id, {
		prompt_id: waiting.prompt.id,
		value: "must-never-be-returned",
	});
	assert.equal(response.prompt, null);
	assert.doesNotMatch(JSON.stringify(response), /must-never-be-returned/);
	await immediate();
	const completed = sessions.get(created.id);
	assert.equal(completed.state, "completed");
	assert.equal(receivedSecret, "must-never-be-returned");
	assert.doesNotMatch(JSON.stringify(completed), /must-never-be-returned/);
	await assert.rejects(
		sessions.create({ provider_id: "missing", type: "oauth" }),
		(error) => error.code === "provider_not_found",
	);
	await assert.rejects(
		sessions.create({ provider_id: "fake", type: "password" }),
		(error) => error.code === "invalid_auth_type",
	);
	assert.throws(
		() => sessions.respond(created.id, { prompt_id: waiting.prompt.id, value: "again" }),
		(error) => error.code === "auth_session_terminal",
	);
});

test("auth sessions serialize a provider and support cancel and expiry", async () => {
	let currentTime = 1000;
	let scheduled;
	const runtime = providerRuntime({
		async login(_provider, _type, interaction) {
			await new Promise((resolve, reject) => {
				interaction.signal.addEventListener(
					"abort",
					() => reject(new Error("cancelled")),
					{ once: true },
				);
			});
		},
	});
	const providers = createProviderService({ runtime });
	const coordinator = new ProviderMutationCoordinator();
	const sessions = new AuthSessionService({
		runtime,
		providers,
		coordinator,
		now: () => currentTime,
		ttlMs: 100,
		schedule(callback) {
			scheduled = callback;
			return { unref() {} };
		},
	});
	const created = await sessions.create({ provider_id: "fake", type: "oauth" });
	await assert.rejects(
		sessions.create({ provider_id: "fake", type: "api_key" }),
		(error) => error.code === "provider_mutation_in_progress",
	);
	assert.equal(sessions.cancel(created.id).state, "cancelled");
	assert.equal(sessions.cancel(created.id).state, "cancelled");
	await immediate();

	const second = await sessions.create({ provider_id: "fake", type: "oauth" });
	currentTime += 100;
	scheduled();
	assert.equal(sessions.get(second.id).state, "expired");
	await immediate();
	assert.throws(() => sessions.get("not-a-session"), /Route not found/);
});

test("auth sessions target an exact account and return its persisted label metadata", async () => {
	const calls = [];
	const runtime = providerRuntime({
		async prepareLogin(input) {
			calls.push(["prepare", input]);
			return {
				account_id: input.accountId,
				account_label: "Existing account",
			};
		},
		async login(provider, type, _interaction, options) {
			calls.push(["login", provider, type, options]);
			return {
				id: "cred_1234567890abcdef12345678",
				label: options.label,
				account_label: "Work identity",
			};
		},
	});
	const sessions = new AuthSessionService({
		runtime,
		providers: createProviderService({ runtime }),
		coordinator: new ProviderMutationCoordinator(),
	});
	const created = await sessions.create({
		provider_id: "fake",
		type: "oauth",
		account_id: "work-account",
		label: "Work identity",
	});
	await immediate();
	const completed = sessions.get(created.id);
	assert.equal(completed.state, "completed");
	assert.equal(completed.account_id, "work-account");
	assert.equal(completed.account_label, "Work identity");
	assert.equal(completed.credential_label, "Work identity");
	assert.deepEqual(calls, [
		["prepare", { providerId: "fake", accountId: "work-account" }],
		[
			"login",
			"fake",
			"oauth",
			{ accountId: "work-account", label: "Work identity" },
		],
	]);
});

test("quota is adapter-driven and unsupported providers stay explicit", async () => {
	const providers = {
		async list() {
			return {
				object: "list",
				data: [
					PROVIDER,
					{ ...PROVIDER, id: "other", name: "Other" },
					{ ...PROVIDER, id: "broken", name: "Broken" },
				],
			};
		},
	};
	const credentialData = [
		{
			id: "cred_fake",
			account_id: "account-a",
			account_label: "Account A",
			provider_id: "fake",
			provider_name: "Fake Provider",
			type: "oauth",
			label: "Fake A",
			active: true,
		},
		{
			id: "cred_other",
			account_id: "account-b",
			account_label: "Account B",
			provider_id: "other",
			provider_name: "Other",
			type: "oauth",
			label: "Other B",
			active: false,
		},
		{
			id: "cred_broken",
			account_id: "account-c",
			account_label: "Account C",
			provider_id: "broken",
			provider_name: "Broken",
			type: "oauth",
			label: "Broken C",
			active: false,
		},
	];
	const credentials = {
		async list() {
			return { object: "list", data: credentialData };
		},
	};
	const quota = createQuotaService({
		providers,
		credentials,
		runtime: {
			async quotaCredentialContexts() {
				return credentialData.map((credential) => ({
					...credential,
					resolveAuth: async () => ({ auth: { apiKey: "test-token" } }),
				}));
			},
		},
		now: () => 1234,
		adapters: new Map([
			["fake", {
				async fetch() {
					return {
						windows: [{
							label: "Monthly",
							unit: "requests",
							used: 4,
							limit: 10,
							resets_at: "2026-08-01T00:00:00Z",
						}],
					};
				},
			}],
			["broken", { async fetch() { throw new Error("raw secret"); } }],
		]),
	});
	assert.deepEqual(await quota.summary(), {
		supported_providers: 2,
		total_providers: 3,
		supported_credentials: 2,
		total_credentials: 3,
	});
	const result = await quota.list();
	assert.equal(result.data[0].status, "available");
	assert.equal(result.data[0].windows[0].remaining, 6);
	assert.equal(result.data[0].checked_at, new Date(1234).toISOString());
	assert.equal(result.data[1].status, "unsupported");
	assert.equal(result.data[2].error_code, "quota_unavailable");
	assert.doesNotMatch(JSON.stringify(result), /raw secret/);
});

test("config service validates, previews, applies, restores, and protects revisions", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-config-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const modelsPath = join(root, "models.json");
	const initial = {
		providers: {
			fake: {
				name: "Fake Provider",
				baseUrl: "https://api.example.test/v1",
				api: "openai-responses",
				headers: { "User-Agent": "pi-router" },
				models: [{
					id: "model",
					name: "Model",
					reasoning: true,
					input: ["text"],
					contextWindow: 1000,
					maxTokens: 100,
					compat: { supportsStrictMode: true },
				}],
			},
		},
	};
	await writeFile(modelsPath, `${JSON.stringify(initial, null, 2)}\n`, { mode: 0o644 });
	let refreshes = 0;
	const config = new ConfigService({
		modelsPath,
		runtime: {
			async refreshConfiguration() {
				refreshes += 1;
			},
		},
	});
	const loaded = await config.get();
	assert.equal(loaded.editable, true);
	assert.equal(loaded.recovery_available, false);
	const candidate = structuredClone(initial);
	candidate.providers.fake.models.push({ id: "second", name: "Second" });
	const preview = await config.preview({ document: candidate });
	assert.equal(preview.valid, true);
	assert.equal(preview.changed, true);
	assert.ok(preview.changes.some((change) => change.path.includes("models")));

	const applied = await config.apply({
		document: candidate,
		expected_revision: preview.revision,
	});
	assert.equal(applied.status, "applied");
	assert.equal(applied.activation, "reloaded");
	assert.equal(applied.restart_required, false);
	assert.equal(refreshes, 1);
	assert.deepEqual(JSON.parse(await readFile(modelsPath, "utf8")), candidate);
	assert.equal((await stat(modelsPath)).mode & 0o777, 0o600);
	assert.deepEqual(
		JSON.parse(await readFile(`${modelsPath}.previous`, "utf8")),
		initial,
	);
	await assert.rejects(
		config.apply({ document: initial, expected_revision: preview.revision }),
		(error) => error.code === "config_revision_conflict",
	);

	const restored = await config.restore({ expected_revision: applied.revision });
	assert.equal(restored.status, "restored");
	assert.deepEqual(JSON.parse(await readFile(modelsPath, "utf8")), initial);
	assert.deepEqual(JSON.parse(await readFile(`${modelsPath}.previous`, "utf8")), candidate);
	assert.equal(refreshes, 2);
	const unchanged = await config.apply({
		document: initial,
		expected_revision: restored.revision,
	});
	assert.equal(unchanged.status, "unchanged");
});

test("config service accepts management-authorized secrets and still rejects malformed documents", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-config-secret-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const modelsPath = join(root, "models.json");
	await writeFile(modelsPath, JSON.stringify({
		providers: {
			fake: {
				apiKey: "must-not-be-returned",
				headers: { Authorization: "also-secret" },
			},
		},
	}));
	const config = new ConfigService({ modelsPath });
	const loaded = await config.get();
	assert.equal(loaded.editable, true);
	assert.equal(loaded.document.providers.fake.apiKey, "must-not-be-returned");
	assert.equal(loaded.document.providers.fake.headers.Authorization, "also-secret");
	const invalid = validateConfigDocument({
		providers: {
			fake: {
				unknown: true,
				baseUrl: "https://user:must-not-return@example.test/v1?key=hidden",
				models: [{
					name: "Missing id",
					compat: {
						supportsStrictMode: "not-a-boolean",
						thinkingFormat: "not-a-format",
						openRouterRouting: {},
					},
				}],
			},
		},
	});
	assert.equal(invalid.valid, false);
	assert.ok(invalid.errors.length >= 6);
	assert.ok(invalid.errors.some((item) =>
		item.path.endsWith("thinkingFormat") && item.message.includes("Must be one of")));
	assert.doesNotMatch(JSON.stringify(invalid), /must-not-return|hidden/);
	const oversized = validateConfigDocument({
		providers: {
			fake: { name: "x".repeat(MAX_CONFIG_BYTES) },
		},
	});
	assert.equal(oversized.valid, false);
	assert.ok(oversized.errors.some((item) => item.message.includes("exceeds")));
	await chmod(modelsPath, 0o600);
});

test("raw config preserves source bytes, validates before replace, and retains recovery", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-raw-config-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const configPath = join(root, "config.yaml");
	const modelsPath = join(root, "models.json");
	const providerPolicyPath = join(root, "provider-policy.json");
	const initial = [
		"# operator comment",
		"host: 127.0.0.1",
		"port: 8318",
		"remote-management:",
		"  allow-remote: false",
		"  secret-key: management-secret",
		"request-logging: true",
		"environment:",
		"  CUSTOM_TOKEN: literal-secret",
		"providers:",
		"  fake:",
		"    baseUrl: https://api.example.test/v1",
		"    api: openai-responses",
		"    apiKey: provider-secret",
		"    models:",
		"      - id: model",
		"",
	].join("\n");
	await writeFile(configPath, initial, { mode: 0o600 });
	let refreshes = 0;
	const eventLog = new OperationalEventLog();
	const service = new RawConfigService({
		configPath,
		modelsPath,
		providerPolicyPath,
		runtime: {
			async refreshConfiguration() {
				refreshes += 1;
			},
		},
		eventLog,
	});
	const loaded = await service.get();
	assert.equal(loaded.source, initial);
	assert.equal(loaded.document.environment.CUSTOM_TOKEN, "literal-secret");
	assert.equal((await service.summary()).raw, true);

	await assert.rejects(
		service.put("host: ["),
		(error) => error.status === 400 && error.code === "invalid_yaml",
	);
	await assert.rejects(
		service.put(initial.replace("port: 8318", "port: -1")),
		(error) => error.status === 422 && error.code === "router_config_invalid",
	);
	await assert.rejects(
		service.put(initial.replace(
			"  CUSTOM_TOKEN: literal-secret",
			[
				"  CUSTOM_TOKEN: literal-secret",
				"  PI_ROUTER_API_KEY: management-secret",
			].join("\n"),
		)),
		(error) => error.status === 422 && error.code === "router_config_invalid",
	);
	assert.equal(await readFile(configPath, "utf8"), initial);

	const candidate = initial
		.replace("# operator comment", "# operator comment retained")
		.replace("request-logging: true", "request-logging: false")
		.replace("api: openai-responses", "api: anthropic-messages");
	const applied = await service.put(candidate);
	assert.equal(applied.status, "applied");
	assert.equal(applied.restart_required, false);
	assert.equal(await readFile(configPath, "utf8"), candidate);
	assert.equal(await readFile(`${configPath}.previous`, "utf8"), initial);
	assert.equal(JSON.parse(await readFile(modelsPath, "utf8"))
		.providers.fake.api, "anthropic-messages");
	assert.equal(eventLog.summary().enabled, false);
	assert.equal(refreshes, 1);
	assert.equal((await stat(configPath)).mode & 0o777, 0o600);

	const restart = await service.put(candidate.replace("port: 8318", "port: 9000"));
	assert.equal(restart.restart_required, true);
	assert.equal(refreshes, 1);
});

test("config service refuses an apply whose complete diff cannot be reviewed", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-config-diff-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const modelsPath = join(root, "models.json");
	const initial = {
		providers: Object.fromEntries(Array.from({ length: 128 }, (_value, index) => [
			`provider-${index}`,
			{
				name: `Provider ${index}`,
				baseUrl: `https://old-${index}.example.test`,
			},
		])),
	};
	await writeFile(modelsPath, `${JSON.stringify(initial, null, 2)}\n`);
	const candidate = structuredClone(initial);
	for (const [id, provider] of Object.entries(candidate.providers)) {
		provider.name = `Updated ${id}`;
		provider.baseUrl = `https://new-${id}.example.test`;
	}
	const config = new ConfigService({ modelsPath });
	const loaded = await config.get();
	const preview = await config.preview({ document: candidate });
	assert.equal(preview.valid, false);
	assert.equal(preview.changed, true);
	assert.match(preview.errors[0].message, /200-change review limit/);
	await assert.rejects(
		config.apply({
			document: candidate,
			expected_revision: loaded.revision,
		}),
		(error) => error.code === "config_diff_too_large",
	);
	assert.deepEqual(JSON.parse(await readFile(modelsPath, "utf8")), initial);
});

test("composed management status aggregates bounded operational state", async () => {
	const events = new OperationalEventLog({ now: () => 2000 });
	events.record({ requestClass: "health", status: 200, durationMs: 1 });
	const updater = {
		async status() {
			return { repository: "owner/repository", install_supported: false };
		},
		async check() {
			return { status: "current" };
		},
		async install() {},
		async rollback() {},
	};
	const management = createManagementService({
		runtime: providerRuntime(),
		account: "work",
		updater,
		startedAt: 1000,
		now: () => 2000,
		eventLog: events,
	});
	const status = await management.status();
	assert.equal(status.service.uptime_seconds, 1);
	assert.deepEqual(status.account, {
		id: "work",
		providers: 1,
		configured_providers: 1,
		stored_credentials: 1,
		available_models: 1,
	});
	assert.equal(status.activity.requests, 1);
	assert.equal(status.quota.supported_providers, 0);
	assert.equal(status.quota.total_credentials, 1);
	assert.deepEqual(status.authentication, {
		management_key_configured: true,
		proxy_api_keys: 0,
	});
	assert.equal(status.config.state, "unsupported");
	assert.deepEqual(await management.checkUpdate(), { status: "current" });
});

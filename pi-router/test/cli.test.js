import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuthInteraction, parseArgs, runCli } from "../src/cli.js";

test("CLI parses serve and login options", () => {
	assert.deepEqual(parseArgs(["serve", "--host", "::1", "--port", "9000", "--account", "a"]), {
		command: "serve",
		host: "::1",
		port: 9000,
		account: "a",
		stateDir: undefined,
		authType: "api_key",
		provider: undefined,
		updateAction: undefined,
		updateVersion: undefined,
	});
	assert.equal(parseArgs(["login", "openai-codex", "--type", "oauth"]).provider, "openai-codex");
	assert.deepEqual(
		{
			action: parseArgs(["update", "install", "0.3.0"]).updateAction,
			version: parseArgs(["update", "install", "0.3.0"]).updateVersion,
		},
		{ action: "install", version: "0.3.0" },
	);
	assert.throws(() => parseArgs(["login"]), /requires a provider/);
	assert.throws(() => parseArgs(["update", "install"]), /requires a version/);
});

test("serve refuses to initialize the runtime without a local API key", async () => {
	let created = false;
	await assert.rejects(
		runCli(["serve"], {
			env: {},
			createRuntime: async () => {
				created = true;
			},
			output: { write() {} },
		}),
		/PI_ROUTER_API_KEY/,
	);
	assert.equal(created, false);
});

test("models command uses router-owned auth and model paths", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-cli-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	let received;
	let output = "";
	const result = await runCli(["models", "--state-dir", root, "--account", "work"], {
		env: {},
		output: { write(chunk) { output += chunk; } },
		createRuntime: async (options) => {
			received = options;
			return {
				async listModels() {
					return [{ provider: "agentrouter", id: "gpt-5.5" }];
				},
			};
		},
	});
	assert.equal(received.authPath, join(root, "accounts", "work", "auth.json"));
	assert.equal(received.modelsPath, join(root, "models.json"));
	assert.equal(received.allowModelNetwork, false);
	assert.equal(output, "agentrouter/gpt-5.5\n");
	assert.deepEqual(result, { command: "models", count: 1 });
});

test("remote model-catalog refresh requires an explicit opt-in", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-network-cli-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const env = { PI_ROUTER_MODEL_NETWORK: "1" };
	let received;
	await runCli(["models", "--state-dir", root], {
		env,
		output: { write() {} },
		createRuntime: async (options) => {
			received = options;
			return { async listModels() { return []; } };
		},
	});
	assert.equal(received.allowModelNetwork, true);
	assert.equal(env.PI_OFFLINE, undefined);
});

test("login and logout delegate without exposing returned credentials", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-auth-cli-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const calls = [];
	let output = "";
	const runtime = {
		async login(provider, type, interaction) {
			calls.push(["login", provider, type]);
			assert.equal(typeof interaction.prompt, "function");
			assert.equal(typeof interaction.notify, "function");
			return { type: "api_key", key: "must-not-be-printed" };
		},
		async logout(provider) {
			calls.push(["logout", provider]);
		},
	};
	const options = {
		env: {},
		output: { write(chunk) { output += chunk; } },
		createRuntime: async () => runtime,
	};
	await runCli(["login", "agentrouter", "--state-dir", root], options);
	await runCli(["logout", "agentrouter", "--state-dir", root], options);
	assert.deepEqual(calls, [
		["login", "agentrouter", "api_key"],
		["logout", "agentrouter"],
	]);
	assert.doesNotMatch(output, /must-not-be-printed/);
});

test("serve wires the selected address and local key into the HTTP server", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-serve-cli-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const runtime = {};
	const server = {};
	const updater = { automatic: false, binaryPath: null };
	let serverOptions;
	let listenOptions;
	let output = "";
	const result = await runCli([
		"serve",
		"--state-dir",
		root,
		"--host",
		"::1",
		"--port",
		"9000",
	], {
		env: { PI_ROUTER_API_KEY: "local-only-key" },
		output: { write(chunk) { output += chunk; } },
		createRuntime: async () => runtime,
		createUpdater: () => updater,
		createServer(options) {
			serverOptions = options;
			return server;
		},
		async listen(receivedServer, options) {
			assert.equal(receivedServer, server);
			listenOptions = options;
			return { address: "::1", family: "IPv6", port: 9000 };
		},
	});
	assert.deepEqual(serverOptions, {
		runtime,
		apiKey: "local-only-key",
		account: "default",
		updater,
		modelsPath: join(root, "models.json"),
	});
	assert.deepEqual(listenOptions, { host: "::1", port: 9000 });
	assert.match(output, /http:\/\/\[::1\]:9000/);
	assert.match(output, /http:\/\/\[::1\]:9000\/management\.html/);
	assert.doesNotMatch(output, /local-only-key/);
	assert.equal(result.server, server);
});

test("update and version commands do not initialize provider state", async () => {
	let created = false;
	const calls = [];
	let output = "";
	const updater = {
		async check() {
			calls.push(["check"]);
			return { status: "current", latest_version: "0.3.0" };
		},
		async install(version) {
			calls.push(["install", version]);
			return { status: "installed", version };
		},
		async rollback() {
			calls.push(["rollback"]);
			return { status: "rolled_back" };
		},
	};
	const options = {
		env: {},
		output: { write(chunk) { output += chunk; } },
		createRuntime: async () => {
			created = true;
		},
		createUpdater: () => updater,
	};
	await runCli(["update", "check"], options);
	await runCli(["update", "install", "0.3.0"], options);
	await runCli(["update", "rollback"], options);
	const version = await runCli(["--version"], options);
	assert.equal(created, false);
	assert.deepEqual(calls, [
		["check"],
		["install", "0.3.0"],
		["rollback"],
	]);
	assert.match(output, /"latest_version": "0.3.0"/);
	assert.match(output, /pi-router 0\.3\.0/);
	assert.deepEqual(version, { command: "version", version: "0.3.0" });
});

test("help does not initialize state or runtime", async () => {
	let created = false;
	let output = "";
	await runCli(["help"], {
		env: {},
		output: { write(chunk) { output += chunk; } },
		createRuntime: async () => {
			created = true;
		},
	});
	assert.equal(created, false);
	assert.match(output, /OpenAI Responses gateway/);
});

test("secret login prompt requires a TTY and never echoes the entered value", async () => {
	const input = new EventEmitter();
	input.isTTY = true;
	input.resume = () => {};
	input.pause = () => {};
	input.setRawMode = () => {};
	let output = "";
	const terminal = {
		isTTY: true,
		write(chunk) {
			output += chunk;
		},
	};
	const interaction = createAuthInteraction({ input, output: terminal });
	const pending = interaction.prompt({ type: "secret", message: "API key" });
	queueMicrotask(() => input.emit("data", Buffer.from("secret-value\r")));
	assert.equal(await pending, "secret-value");
	assert.doesNotMatch(output, /secret-value/);

	await assert.rejects(
		createAuthInteraction({
			input: { isTTY: false },
			output: { isTTY: false },
		}).prompt({ type: "secret", message: "API key" }),
		/interactive TTY/,
	);
});

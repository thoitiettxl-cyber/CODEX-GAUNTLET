import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { PiRuntime } from "../src/pi-runtime.js";

test("pinned Pi ModelRuntime loads without model-network access", { timeout: 10_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-router-runtime-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const runtime = await PiRuntime.create({
		authPath: join(root, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
	});
	const models = await runtime.listModels();
	assert.equal(Array.isArray(models), true);
});

test("pinned Pi runtime stores a custom-provider API key and exposes its model", { timeout: 10_000 }, async (t) => {
	const previousOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	t.after(() => {
		if (previousOffline === undefined) {
			delete process.env.PI_OFFLINE;
		} else {
			process.env.PI_OFFLINE = previousOffline;
		}
	});
	const root = await mkdtemp(join(tmpdir(), "pi-router-custom-provider-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const authPath = join(root, "auth.json");
	const modelsPath = join(root, "models.json");
	await writeFile(modelsPath, JSON.stringify({
		providers: {
			agentrouter: {
				baseUrl: "https://agentrouter.org/v1",
				api: "openai-completions",
				models: [{ id: "gpt-5.5" }],
			},
		},
	}));
	const runtime = await PiRuntime.create({
		authPath,
		modelsPath,
		allowModelNetwork: false,
	});
	let prompts = 0;
	await runtime.login("agentrouter", "api_key", {
		async prompt(prompt) {
			prompts += 1;
			assert.equal(prompt.type, "secret");
			return "test-only-not-a-real-key";
		},
		notify() {},
	});
	assert.equal(prompts, 1);
	const authMetadata = await stat(authPath);
	assert.equal(authMetadata.isFile(), true);
	assert.equal(authMetadata.mode & 0o777, 0o600);
	assert.equal(
		(await runtime.listModels()).some((model) =>
			model.provider === "agentrouter" && model.id === "gpt-5.5"),
		true,
	);
});

test("pinned Pi runtime composes the checked-in AgentRouter client profile", { timeout: 10_000 }, async (t) => {
	const previousOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	t.after(() => {
		if (previousOffline === undefined) {
			delete process.env.PI_OFFLINE;
		} else {
			process.env.PI_OFFLINE = previousOffline;
		}
	});
	const credentials = {
		async read() {
			return undefined;
		},
		async list() {
			return [];
		},
		async modify(_providerId, update) {
			return update(undefined);
		},
		async delete() {},
	};
	const entries = new Map();
	const modelsStore = {
		async read(providerId) {
			return entries.get(providerId);
		},
		async write(providerId, value) {
			entries.set(providerId, structuredClone(value));
		},
		async delete(providerId) {
			entries.delete(providerId);
		},
	};
	const modelsPath = fileURLToPath(
		new URL("../examples/models.agentrouter.json", import.meta.url),
	);
	const runtime = await ModelRuntime.create({
		credentials,
		modelsPath,
		modelsStore,
		allowModelNetwork: false,
	});
	await runtime.setRuntimeApiKey("agentrouter", "test-only-not-a-real-key", {
		allowNetwork: false,
	});
	t.after(() => runtime.removeRuntimeApiKey("agentrouter"));

	const available = await runtime.getAvailable("agentrouter");
	assert.deepEqual(available.map((model) => model.id), [
		"claude-opus-4-8",
		"gpt-5.5",
		"gpt-5.6-sol",
		"glm-5.2",
		"kimi-k3",
	]);
	const claude = runtime.getModel("agentrouter", "claude-opus-4-8");
	assert.equal(claude.api, "anthropic-messages");
	assert.equal(claude.compat.supportsStrictTools, true);
	const auth = await runtime.getAuth(claude);
	assert.equal(auth.auth.headers["User-Agent"], "pi-coding-agent");
});

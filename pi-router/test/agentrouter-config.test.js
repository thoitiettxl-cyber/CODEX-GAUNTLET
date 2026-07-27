import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateConfigDocument } from "../src/management/config-policy.js";

const configUrl = new URL("../examples/models.agentrouter.json", import.meta.url);

test("AgentRouter example declares the live-tested Pi client profile and model protocols", async () => {
	const config = JSON.parse(await readFile(configUrl, "utf8"));
	const provider = config.providers.agentrouter;
	assert.equal(provider.baseUrl, "https://agentrouter.org/v1");
	assert.equal(provider.api, "openai-completions");
	assert.equal(provider.headers["User-Agent"], "pi-coding-agent");
	assert.equal(Object.hasOwn(provider, "apiKey"), false);
	assert.deepEqual(validateConfigDocument(config), {
		valid: true,
		errors: [],
		document: config,
	});

	const models = new Map(provider.models.map((model) => [model.id, model]));
	assert.deepEqual([...models.keys()], [
		"claude-opus-4-8",
		"gpt-5.5",
		"gpt-5.6-sol",
		"glm-5.2",
		"kimi-k3",
	]);

	const claude = models.get("claude-opus-4-8");
	assert.equal(claude.api, "anthropic-messages");
	assert.equal(claude.baseUrl, "https://agentrouter.org");
	assert.equal(claude.compat.forceAdaptiveThinking, true);
	assert.equal(claude.compat.supportsStrictTools, true);
	for (const id of ["gpt-5.5", "gpt-5.6-sol", "glm-5.2", "kimi-k3"]) {
		assert.equal(models.get(id).api, undefined);
		assert.equal(models.get(id).baseUrl, undefined);
	}
});

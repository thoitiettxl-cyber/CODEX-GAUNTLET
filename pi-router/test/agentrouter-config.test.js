import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../examples/models.agentrouter.json", import.meta.url);

test("AgentRouter example declares the live-tested Pi client profile and model protocols", async () => {
	const config = JSON.parse(await readFile(configUrl, "utf8"));
	const provider = config.providers.agentrouter;
	assert.equal(provider.baseUrl, "https://agentrouter.org/v1");
	assert.equal(provider.api, "openai-completions");
	assert.equal(provider.headers["User-Agent"], "pi-coding-agent");
	assert.equal(Object.hasOwn(provider, "apiKey"), false);

	const models = new Map(provider.models.map((model) => [model.id, model]));
	assert.deepEqual([...models.keys()], [
		"claude-opus-4-8",
		"claude-opus-4-6",
		"gpt-5.5",
		"gpt-5.6-sol",
		"glm-5.2",
		"kimi-k3",
	]);

	for (const id of ["claude-opus-4-8", "claude-opus-4-6"]) {
		const model = models.get(id);
		assert.equal(model.api, "anthropic-messages");
		assert.equal(model.baseUrl, "https://agentrouter.org");
		assert.equal(model.compat.forceAdaptiveThinking, true);
		assert.equal(model.compat.supportsStrictTools, true);
	}
	for (const id of ["gpt-5.5", "gpt-5.6-sol", "glm-5.2", "kimi-k3"]) {
		assert.equal(models.get(id).api, undefined);
		assert.equal(models.get(id).baseUrl, undefined);
	}
});

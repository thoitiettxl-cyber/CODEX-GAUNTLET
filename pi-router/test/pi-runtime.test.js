import assert from "node:assert/strict";
import test from "node:test";

import { PiRuntime, publicModel } from "../src/pi-runtime.js";
import { MODEL } from "./helpers.js";

function wrapped(models = [MODEL]) {
	const calls = [];
	const runtime = new PiRuntime({
		async getAvailable() {
			return models;
		},
		streamSimple(...args) {
			calls.push(["stream", ...args]);
			return "stream";
		},
		async login(...args) {
			calls.push(["login", ...args]);
			return { type: "api_key" };
		},
		async logout(...args) {
			calls.push(["logout", ...args]);
		},
	});
	return { runtime, calls };
}

test("PiRuntime resolves qualified and unique model names", async () => {
	const { runtime } = wrapped();
	assert.equal(await runtime.resolveModel("fake/model"), MODEL);
	assert.equal(await runtime.resolveModel("model"), MODEL);
	await assert.rejects(runtime.resolveModel(""), /required/);
	await assert.rejects(runtime.resolveModel("missing"), /Unknown/);
});

test("PiRuntime rejects ambiguous unqualified model names", async () => {
	const { runtime } = wrapped([
		MODEL,
		{ ...MODEL, provider: "other" },
	]);
	await assert.rejects(runtime.resolveModel("model"), /ambiguous/);
});

test("PiRuntime delegates streaming and credential operations", async () => {
	const { runtime, calls } = wrapped();
	const context = { messages: [] };
	const interaction = { prompt: async () => "", notify() {} };
	assert.equal(runtime.stream(MODEL, context, { reasoning: "low" }), "stream");
	await runtime.login("fake", "api_key", interaction);
	await runtime.logout("fake");
	assert.deepEqual(calls.map((call) => call[0]), ["stream", "login", "logout"]);
	assert.deepEqual(publicModel(MODEL), {
		id: "fake/model",
		object: "model",
		created: 0,
		owned_by: "fake",
	});
});

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
		getProviders() {
			return [{
				id: "fake",
				name: "Fake Provider",
				auth: {
					apiKey: { login() {} },
					oauth: { login() {} },
				},
			}];
		},
		getModels() {
			return models;
		},
		async listCredentials() {
			return [{ providerId: "fake", type: "api_key" }];
		},
		getProviderAuthStatus() {
			return {
				configured: true,
				source: "stored",
				label: "/must-not-expose/auth.json",
			};
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
		async refresh(...args) {
			calls.push(["refresh", ...args]);
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
	await runtime.refreshConfiguration();
	assert.deepEqual(calls.map((call) => call[0]), ["stream", "login", "logout", "refresh"]);
	assert.deepEqual(publicModel(MODEL), {
		id: "fake/model",
		object: "model",
		created: 0,
		owned_by: "fake",
	});
});

test("PiRuntime exposes only provider and credential metadata to management", async () => {
	const { runtime } = wrapped();
	const providers = await runtime.listProviderMetadata();
	assert.deepEqual(providers, [{
		id: "fake",
		name: "Fake Provider",
		auth_modes: [
			{ type: "api_key", login_supported: true },
			{ type: "oauth", login_supported: true },
		],
		configured: true,
		configured_source: "stored",
		credential_type: "api_key",
		model_count: 1,
		available_model_count: 1,
		state: "available",
	}]);
	assert.doesNotMatch(JSON.stringify(providers), /must-not-expose|auth\\.json/);
	assert.deepEqual(await runtime.listCredentialMetadata(), [{
		provider_id: "fake",
		provider_name: "Fake Provider",
		type: "api_key",
	}]);
});

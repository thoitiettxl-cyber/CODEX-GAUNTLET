import { once } from "node:events";

export const MODEL = Object.freeze({
	provider: "fake",
	id: "model",
	api: "openai-completions",
	name: "Fake Model",
});

export function message(content, stopReason = "stop") {
	return {
		role: "assistant",
		content,
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 3,
			output: 2,
			cacheRead: 1,
			cacheWrite: 0,
			totalTokens: 5,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

export async function* textStream(text = "hello") {
	const partial = message([{ type: "text", text: "" }]);
	yield { type: "start", partial };
	yield { type: "text_start", contentIndex: 0, partial };
	yield { type: "text_delta", contentIndex: 0, delta: text, partial };
	yield { type: "text_end", contentIndex: 0, content: text, partial };
	yield { type: "done", reason: "stop", message: message([{ type: "text", text }]) };
}

export async function closeServer(server) {
	server.close();
	await once(server, "close");
}

export function addressUrl(address) {
	const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
	return `http://${host}:${address.port}`;
}

export function fakeRuntime({
	stream = () => textStream(),
	providers = [{
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
	}],
	credentials = [],
	login = async () => ({ type: "api_key" }),
	logout = async () => {},
	resolveAuth = async () => ({ auth: { apiKey: "test-provider-token" } }),
	quotaContexts,
	refreshConfiguration = async () => {},
} = {}) {
	return {
		async listModels() {
			return [MODEL];
		},
		async listProviderMetadata() {
			return providers;
		},
		async listCredentialMetadata() {
			return credentials;
		},
		async resolveModel(name) {
			if (name !== "fake/model" && name !== "model") {
				throw new Error("unexpected model");
			}
			return MODEL;
		},
		stream,
		login,
		logout,
		resolveAuth,
		async quotaCredentialContexts() {
			if (quotaContexts) {
				return quotaContexts;
			}
			return credentials.map((credential) => ({
				id: credential.id ?? credential.provider_id,
				account_id: credential.account_id ?? "default",
				account_label: credential.account_label ?? "default",
				label: credential.label ?? credential.provider_name ?? credential.provider_id,
				active: credential.active ?? true,
				...credential,
				resolveAuth,
			}));
		},
		refreshConfiguration,
	};
}

export function fakeProxyKeyStore(value = "local-test-key") {
	const createdAt = "2026-07-27T00:00:00.000Z";
	const entry = {
		id: "key_00000000-0000-4000-8000-000000000001",
		label: "Test proxy key",
		created_at: createdAt,
		updated_at: createdAt,
	};
	return {
		authorize(candidate) {
			return candidate === value;
		},
		count() {
			return 1;
		},
		list() {
			return { object: "list", data: [{ ...entry }] };
		},
	};
}

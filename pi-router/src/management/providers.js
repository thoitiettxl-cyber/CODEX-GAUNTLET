import { safeIdentity, safeText } from "./validation.js";

const AUTH_MODES = new Set(["api_key", "oauth"]);
const PROVIDER_STATES = new Set(["available", "configured", "unconfigured", "error"]);

function normalizeMode(mode) {
	if (!mode || !AUTH_MODES.has(mode.type)) {
		return undefined;
	}
	return {
		type: mode.type,
		login_supported: mode.login_supported === true,
	};
}

function normalizeProvider(provider) {
	const id = safeIdentity(provider?.id, 64);
	if (!id) {
		return undefined;
	}
	const authModes = Array.isArray(provider.auth_modes)
		? provider.auth_modes.map(normalizeMode).filter(Boolean)
		: [];
	const state = PROVIDER_STATES.has(provider.state) ? provider.state : "error";
	return {
		id,
		name: safeText(provider.name, 96, id),
		auth_modes: authModes,
		configured: provider.configured === true,
		configured_source: safeText(provider.configured_source, 96, "") || null,
		credential_type: AUTH_MODES.has(provider.credential_type)
			? provider.credential_type
			: null,
		model_count: Number.isSafeInteger(provider.model_count)
			? Math.max(0, provider.model_count)
			: 0,
		available_model_count: Number.isSafeInteger(provider.available_model_count)
			? Math.max(0, provider.available_model_count)
			: 0,
		credential_count: Number.isSafeInteger(provider.credential_count)
			? Math.max(0, provider.credential_count)
			: (provider.credential_type ? 1 : 0),
		configuration_required: safeText(provider.configuration_required, 96, "") || null,
		state,
	};
}

export function createProviderService({ runtime } = {}) {
	if (!runtime || typeof runtime.listProviderMetadata !== "function") {
		throw new TypeError("runtime.listProviderMetadata is required");
	}
	return {
		async list() {
			const providers = await runtime.listProviderMetadata();
			const data = providers
				.map(normalizeProvider)
				.filter(Boolean)
				.sort((left, right) => left.name.localeCompare(right.name));
			return {
				object: "list",
				data,
			};
		},
	};
}

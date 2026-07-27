import { invalidRequest } from "./errors.js";

export class PiRuntime {
	constructor(runtime) {
		this.runtime = runtime;
	}

	static async create({ authPath, modelsPath, allowModelNetwork = false } = {}) {
		const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
		const runtime = await ModelRuntime.create({
			authPath,
			modelsPath,
			allowModelNetwork,
		});
		return new PiRuntime(runtime);
	}

	async listModels() {
		return [...(await this.runtime.getAvailable())];
	}

	async listProviderMetadata() {
		const providers = [...this.runtime.getProviders()];
		const allModels = [...this.runtime.getModels()];
		const credentials = [...await this.runtime.listCredentials()];
		let availableModels = [];
		let availabilityFailed = false;
		try {
			availableModels = await this.listModels();
		} catch {
			availabilityFailed = true;
		}
		const stored = new Map(credentials.map((entry) => [entry.providerId, entry.type]));
		return providers.map((provider) => {
			const configured = this.runtime.getProviderAuthStatus(provider.id);
			const modelCount = allModels.filter((model) => model.provider === provider.id).length;
			const availableModelCount = availableModels
				.filter((model) => model.provider === provider.id)
				.length;
			return {
				id: provider.id,
				name: provider.name,
				auth_modes: [
					provider.auth?.apiKey
						? {
							type: "api_key",
							login_supported: typeof provider.auth.apiKey.login === "function",
						}
						: undefined,
					provider.auth?.oauth
						? {
							type: "oauth",
							login_supported: typeof provider.auth.oauth.login === "function",
						}
						: undefined,
				].filter(Boolean),
				configured: configured?.configured === true,
				configured_source: typeof configured?.source === "string"
					? configured.source
					: undefined,
				credential_type: stored.get(provider.id),
				model_count: modelCount,
				available_model_count: availableModelCount,
				state: availabilityFailed
					? "error"
					: (
						configured?.configured === true
							? (availableModelCount > 0 ? "available" : "configured")
							: "unconfigured"
					),
			};
		});
	}

	async listCredentialMetadata() {
		const providers = new Map(
			this.runtime.getProviders().map((provider) => [provider.id, provider.name]),
		);
		return [...await this.runtime.listCredentials()].map((credential) => ({
			provider_id: credential.providerId,
			provider_name: providers.get(credential.providerId) ?? credential.providerId,
			type: credential.type,
		}));
	}

	async resolveModel(requested) {
		if (typeof requested !== "string" || !requested.trim()) {
			throw invalidRequest("The model field is required.", "model_required");
		}
		const name = requested.trim();
		const available = await this.listModels();
		const slash = name.indexOf("/");
		if (slash > 0) {
			const provider = name.slice(0, slash);
			const modelId = name.slice(slash + 1);
			const match = available.find((model) => model.provider === provider && model.id === modelId);
			if (!match) {
				throw invalidRequest(`Unknown or unavailable model '${name}'.`, "model_not_found");
			}
			return match;
		}
		const matches = available.filter((model) => model.id === name);
		if (matches.length === 0) {
			throw invalidRequest(`Unknown or unavailable model '${name}'.`, "model_not_found");
		}
		if (matches.length > 1) {
			throw invalidRequest(
				`Model '${name}' is ambiguous; use provider/model.`,
				"model_ambiguous",
			);
		}
		return matches[0];
	}

	stream(model, context, options) {
		return this.runtime.streamSimple(model, context, options);
	}

	async login(providerId, type, interaction) {
		return this.runtime.login(providerId, type, interaction);
	}

	async logout(providerId) {
		await this.runtime.logout(providerId);
	}

	async refreshConfiguration() {
		await this.runtime.refresh({ allowNetwork: false });
	}
}

export function publicModel(model) {
	return {
		id: `${model.provider}/${model.id}`,
		object: "model",
		created: 0,
		owned_by: model.provider,
	};
}

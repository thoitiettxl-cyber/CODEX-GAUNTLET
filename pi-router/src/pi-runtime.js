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
}

export function publicModel(model) {
	return {
		id: `${model.provider}/${model.id}`,
		object: "model",
		created: 0,
		owned_by: model.provider,
	};
}

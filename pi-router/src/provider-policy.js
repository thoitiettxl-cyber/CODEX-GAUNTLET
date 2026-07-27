import { readFile, stat } from "node:fs/promises";

import { RouterError } from "./errors.js";

export const PROVIDER_POLICY_VERSION = 1;
export const MAX_PROVIDER_POLICY_BYTES = 128 * 1024;
const UPSTREAM_MODEL = Symbol("pi-router-upstream-model");
const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const POLICY_FIELDS = new Set(["proxyUrl", "modelAliases", "excludedModels"]);
const MAX_PROVIDER_POLICIES = 128;
const MAX_MODEL_RULES = 512;

function invalidPolicy() {
	throw new RouterError("Provider policy is invalid.", {
		status: 500,
		code: "provider_policy_invalid",
		expose: true,
	});
}

function validRule(value) {
	return (
		typeof value === "string"
		&& value.length >= 1
		&& value.length <= 160
		&& !/[\u0000-\u001f\u007f]/u.test(value)
	);
}

function validProxyUrl(value) {
	if (typeof value !== "string" || value.length > 2048) {
		return false;
	}
	try {
		const parsed = new URL(value);
		return (
			["http:", "https:"].includes(parsed.protocol)
			&& !parsed.username
			&& !parsed.password
			&& !parsed.search
			&& !parsed.hash
		);
	} catch {
		return false;
	}
}

function validProviderPolicy(value) {
	if (
		!value
		|| typeof value !== "object"
		|| Array.isArray(value)
		|| Object.keys(value).some((key) => !POLICY_FIELDS.has(key))
	) {
		return false;
	}
	if ("proxyUrl" in value && !validProxyUrl(value.proxyUrl)) {
		return false;
	}
	if ("modelAliases" in value) {
		if (
			!value.modelAliases
			|| typeof value.modelAliases !== "object"
			|| Array.isArray(value.modelAliases)
		) {
			return false;
		}
		const aliases = Object.entries(value.modelAliases);
		if (
			aliases.length > MAX_MODEL_RULES
			|| aliases.some(([modelId, alias]) =>
				!validRule(modelId)
				|| !validRule(alias)
				|| alias.includes("/"))
			|| new Set(aliases.map(([, alias]) => alias)).size !== aliases.length
		) {
			return false;
		}
	}
	if (
		"excludedModels" in value
		&& (
			!Array.isArray(value.excludedModels)
			|| value.excludedModels.length > MAX_MODEL_RULES
			|| value.excludedModels.some((pattern) => !validRule(pattern))
		)
	) {
		return false;
	}
	return true;
}

function wildcard(pattern, value) {
	const escaped = pattern
		.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&")
		.replace(/\*/gu, ".*");
	return new RegExp(`^${escaped}$`, "u").test(value);
}

function emptyPolicy() {
	return { version: PROVIDER_POLICY_VERSION, providers: {} };
}

export function validateProviderPolicy(document) {
	if (
		!document
		|| typeof document !== "object"
		|| Array.isArray(document)
		|| document.version !== PROVIDER_POLICY_VERSION
		|| !document.providers
		|| typeof document.providers !== "object"
		|| Array.isArray(document.providers)
	) {
		invalidPolicy();
	}
	const providers = Object.entries(document.providers);
	if (
		providers.length > MAX_PROVIDER_POLICIES
		|| providers.some(([providerId, value]) =>
			!PROVIDER_PATTERN.test(providerId) || !validProviderPolicy(value))
	) {
		invalidPolicy();
	}
	return document;
}

export async function readProviderPolicy(path, { missing = true } = {}) {
	if (!path) {
		return emptyPolicy();
	}
	let metadata;
	try {
		metadata = await stat(path);
	} catch (error) {
		if (missing && error?.code === "ENOENT") {
			return emptyPolicy();
		}
		throw error;
	}
	if (!metadata.isFile() || metadata.size > MAX_PROVIDER_POLICY_BYTES) {
		throw new RouterError("Provider policy is invalid.", {
			status: 500,
			code: "provider_policy_invalid",
			expose: true,
		});
	}
	const bytes = await readFile(path);
	if (bytes.length > MAX_PROVIDER_POLICY_BYTES) {
		throw new RouterError("Provider policy is invalid.", {
			status: 500,
			code: "provider_policy_invalid",
			expose: true,
		});
	}
	try {
		return validateProviderPolicy(JSON.parse(bytes.toString("utf8")));
	} catch (error) {
		if (error instanceof RouterError) {
			throw error;
		}
		throw new RouterError("Provider policy is not valid JSON.", {
			status: 500,
			code: "provider_policy_invalid",
			expose: true,
		});
	}
}

export class ProviderPolicy {
	constructor({ path, document = emptyPolicy() } = {}) {
		this.path = path;
		this.document = document;
	}

	static async open({ path } = {}) {
		return new ProviderPolicy({
			path,
			document: await readProviderPolicy(path),
		});
	}

	async reload() {
		this.document = await readProviderPolicy(this.path);
	}

	#provider(providerId) {
		return this.document.providers[providerId] ?? {};
	}

	apply(models) {
		const result = [];
		const exposed = new Set();
		for (const model of models) {
			const policy = this.#provider(model.provider);
			const excluded = (policy.excludedModels ?? []).some((pattern) =>
				wildcard(pattern, model.id)
				|| wildcard(pattern, `${model.provider}/${model.id}`));
			if (excluded) {
				continue;
			}
			const alias = policy.modelAliases?.[model.id];
			const selected = alias ? { ...model, id: alias } : model;
			const key = `${selected.provider}\0${selected.id}`;
			if (exposed.has(key)) {
				throw new RouterError(
					`Provider policy exposes duplicate model '${selected.provider}/${selected.id}'.`,
					{
						status: 500,
						code: "provider_policy_model_collision",
						expose: true,
					},
				);
			}
			exposed.add(key);
			if (selected !== model) {
				Object.defineProperty(selected, UPSTREAM_MODEL, {
					value: model,
					enumerable: false,
				});
			}
			result.push(selected);
		}
		return result;
	}

	unwrap(model) {
		return model?.[UPSTREAM_MODEL] ?? model;
	}

	proxyUrl(providerId) {
		const value = this.#provider(providerId).proxyUrl;
		return typeof value === "string" ? value : undefined;
	}
}

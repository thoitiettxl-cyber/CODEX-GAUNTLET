// Safe browser-editable subset of the pinned Pi models.json contract.
import { isRecord } from "./validation.js";

export const MAX_CONFIG_BYTES = 128 * 1024;

const PROVIDER_FIELDS = new Set([
	"name",
	"baseUrl",
	"api",
	"oauth",
	"headers",
	"compat",
	"authHeader",
	"models",
	"modelOverrides",
]);
const MODEL_FIELDS = new Set([
	"id",
	"name",
	"api",
	"baseUrl",
	"reasoning",
	"thinkingLevelMap",
	"input",
	"cost",
	"contextWindow",
	"maxTokens",
	"headers",
	"compat",
]);
const MODEL_OVERRIDE_FIELDS = new Set([
	"name",
	"reasoning",
	"thinkingLevelMap",
	"input",
	"cost",
	"contextWindow",
	"maxTokens",
	"headers",
	"compat",
]);
const COMPAT_FIELDS = new Set([
	"supportsStore",
	"supportsDeveloperRole",
	"supportsReasoningEffort",
	"supportsUsageInStreaming",
	"maxTokensField",
	"requiresToolResultName",
	"requiresAssistantAfterToolResult",
	"requiresThinkingAsText",
	"requiresReasoningContentOnAssistantMessages",
	"thinkingFormat",
	"cacheControlFormat",
	"supportsOpenAIGrammarTools",
	"supportsStrictMode",
	"sendSessionAffinityHeaders",
	"deferredToolsMode",
	"sessionAffinityFormat",
	"supportsLongCacheRetention",
	"supportsToolSearch",
	"supportsEagerToolInputStreaming",
	"supportsCacheControlOnTools",
	"supportsTemperature",
	"forceAdaptiveThinking",
	"allowEmptySignature",
	"supportsStrictTools",
	"supportsToolReferences",
]);
const COMPAT_ENUM_FIELDS = new Map([
	["maxTokensField", new Set(["max_completion_tokens", "max_tokens"])],
	["thinkingFormat", new Set([
		"openai",
		"openrouter",
		"together",
		"deepseek",
		"zai",
		"qwen",
		"chat-template",
		"qwen-chat-template",
		"string-thinking",
		"ant-ling",
	])],
	["cacheControlFormat", new Set(["anthropic"])],
	["deferredToolsMode", new Set(["kimi"])],
	["sessionAffinityFormat", new Set(["openai", "openai-nosession", "openrouter"])],
]);
const SAFE_HEADERS = new Set([
	"accept",
	"content-type",
	"user-agent",
	"x-client-name",
	"x-client-version",
]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function collector() {
	const errors = [];
	return {
		add(path, message) {
			if (errors.length < 32) {
				errors.push({ path, message });
			}
		},
		result(document) {
			return errors.length > 0
				? { valid: false, errors }
				: { valid: true, errors: [], document: structuredClone(document) };
		},
	};
}

function allowedKeys(value, allowed, path, state) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			state.add(`${path}.${key}`, "Field is not editable through the Management API.");
		}
	}
}

function stringValue(value, path, state, max = 512) {
	if (typeof value !== "string" || value.length === 0 || value.length > max) {
		state.add(path, `Must be a non-empty string of at most ${max} characters.`);
	}
}

function numberValue(value, path, state) {
	if (!Number.isFinite(value) || value < 0) {
		state.add(path, "Must be a finite non-negative number.");
	}
}

function booleanValue(value, path, state) {
	if (typeof value !== "boolean") {
		state.add(path, "Must be a boolean.");
	}
}

function baseUrl(value, path, state) {
	stringValue(value, path, state, 2048);
	if (typeof value !== "string" || value.length > 2048) {
		return;
	}
	try {
		const parsed = new URL(value);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			state.add(path, "Must use http or https.");
		}
		if (parsed.username || parsed.password || parsed.search || parsed.hash) {
			state.add(
				path,
				"Must not contain URL credentials, query parameters, or a fragment.",
			);
		}
	} catch {
		state.add(path, "Must be an absolute URL.");
	}
}

function headers(value, path, state) {
	if (!isRecord(value)) {
		state.add(path, "Must be an object.");
		return;
	}
	const entries = Object.entries(value);
	if (entries.length > 16) {
		state.add(path, "May contain at most 16 headers.");
	}
	for (const [name, headerValue] of entries) {
		if (!SAFE_HEADERS.has(name.toLowerCase())) {
			state.add(`${path}.${name}`, "Header is not on the non-secret allowlist.");
		}
		stringValue(headerValue, `${path}.${name}`, state, 256);
	}
}

function compat(value, path, state) {
	if (!isRecord(value)) {
		state.add(path, "Must be an object.");
		return;
	}
	allowedKeys(value, COMPAT_FIELDS, path, state);
	for (const [key, entry] of Object.entries(value)) {
		if (!COMPAT_FIELDS.has(key)) {
			continue;
		}
		const values = COMPAT_ENUM_FIELDS.get(key);
		if (values) {
			stringValue(entry, `${path}.${key}`, state, 80);
			if (typeof entry === "string" && !values.has(entry)) {
				state.add(
					`${path}.${key}`,
					`Must be one of: ${[...values].join(", ")}.`,
				);
			}
		} else {
			booleanValue(entry, `${path}.${key}`, state);
		}
	}
}

function thinkingLevels(value, path, state) {
	if (!isRecord(value)) {
		state.add(path, "Must be an object.");
		return;
	}
	allowedKeys(value, THINKING_LEVELS, path, state);
	for (const [key, entry] of Object.entries(value)) {
		if (entry !== null && typeof entry !== "string") {
			state.add(`${path}.${key}`, "Must be a string or null.");
		}
	}
}

function cost(value, path, state, partial) {
	if (!isRecord(value)) {
		state.add(path, "Must be an object.");
		return;
	}
	const allowed = new Set(["input", "output", "cacheRead", "cacheWrite", "tiers"]);
	allowedKeys(value, allowed, path, state);
	for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
		if (!partial && !(key in value)) {
			state.add(`${path}.${key}`, "Field is required.");
		} else if (key in value) {
			numberValue(value[key], `${path}.${key}`, state);
		}
	}
	if ("tiers" in value) {
		if (!Array.isArray(value.tiers) || value.tiers.length > 32) {
			state.add(`${path}.tiers`, "Must be an array of at most 32 entries.");
		} else {
			value.tiers.forEach((tier, index) => {
				const tierPath = `${path}.tiers.${index}`;
				if (!isRecord(tier)) {
					state.add(tierPath, "Must be an object.");
					return;
				}
				const fields = new Set([
					"inputTokensAbove",
					"input",
					"output",
					"cacheRead",
					"cacheWrite",
				]);
				allowedKeys(tier, fields, tierPath, state);
				for (const key of fields) {
					if (!(key in tier)) {
						state.add(`${tierPath}.${key}`, "Field is required.");
					} else {
						numberValue(tier[key], `${tierPath}.${key}`, state);
					}
				}
			});
		}
	}
}

function commonModelFields(value, path, state, fields, partial) {
	if (!isRecord(value)) {
		state.add(path, "Must be an object.");
		return;
	}
	allowedKeys(value, fields, path, state);
	if (!partial) {
		if (!("id" in value)) {
			state.add(`${path}.id`, "Field is required.");
		} else {
			stringValue(value.id, `${path}.id`, state, 160);
		}
	}
	for (const key of ["name", "api"]) {
		if (key in value) {
			stringValue(value[key], `${path}.${key}`, state, key === "api" ? 80 : 160);
		}
	}
	if ("baseUrl" in value) {
		baseUrl(value.baseUrl, `${path}.baseUrl`, state);
	}
	if ("reasoning" in value) {
		booleanValue(value.reasoning, `${path}.reasoning`, state);
	}
	if ("thinkingLevelMap" in value) {
		thinkingLevels(value.thinkingLevelMap, `${path}.thinkingLevelMap`, state);
	}
	if ("input" in value) {
		if (
			!Array.isArray(value.input)
			|| value.input.length > 2
			|| value.input.some((entry) => !["text", "image"].includes(entry))
		) {
			state.add(`${path}.input`, "Must contain only text and image.");
		}
	}
	if ("cost" in value) {
		cost(value.cost, `${path}.cost`, state, partial);
	}
	for (const key of ["contextWindow", "maxTokens"]) {
		if (key in value) {
			numberValue(value[key], `${path}.${key}`, state);
		}
	}
	if ("headers" in value) {
		headers(value.headers, `${path}.headers`, state);
	}
	if ("compat" in value) {
		compat(value.compat, `${path}.compat`, state);
	}
}

function provider(value, path, state) {
	if (!isRecord(value)) {
		state.add(path, "Must be an object.");
		return;
	}
	if ("apiKey" in value) {
		state.add(`${path}.apiKey`, "Secret-bearing apiKey is not editable.");
	}
	allowedKeys(value, PROVIDER_FIELDS, path, state);
	if ("name" in value) {
		stringValue(value.name, `${path}.name`, state, 160);
	}
	if ("baseUrl" in value) {
		baseUrl(value.baseUrl, `${path}.baseUrl`, state);
	}
	if ("api" in value) {
		stringValue(value.api, `${path}.api`, state, 80);
	}
	if ("oauth" in value && value.oauth !== "radius") {
		state.add(`${path}.oauth`, "Only the radius OAuth adapter is configurable.");
	}
	if ("authHeader" in value) {
		booleanValue(value.authHeader, `${path}.authHeader`, state);
	}
	if ("headers" in value) {
		headers(value.headers, `${path}.headers`, state);
	}
	if ("compat" in value) {
		compat(value.compat, `${path}.compat`, state);
	}
	if ("models" in value) {
		if (!Array.isArray(value.models) || value.models.length > 512) {
			state.add(`${path}.models`, "Must be an array of at most 512 models.");
		} else {
			value.models.forEach((model, index) =>
				commonModelFields(model, `${path}.models.${index}`, state, MODEL_FIELDS, false));
		}
	}
	if ("modelOverrides" in value) {
		if (!isRecord(value.modelOverrides) || Object.keys(value.modelOverrides).length > 512) {
			state.add(`${path}.modelOverrides`, "Must be an object with at most 512 entries.");
		} else {
			for (const [id, model] of Object.entries(value.modelOverrides)) {
				if (!id || id.length > 160) {
					state.add(`${path}.modelOverrides`, "Model override id is invalid.");
					continue;
				}
				commonModelFields(
					model,
					`${path}.modelOverrides.${id}`,
					state,
					MODEL_OVERRIDE_FIELDS,
					true,
				);
			}
		}
	}
}

export function validateConfigDocument(document) {
	const state = collector();
	let serialized;
	try {
		serialized = `${JSON.stringify(document, null, 2)}\n`;
	} catch {
		state.add("root", "Must be JSON-serializable.");
		return state.result({});
	}
	if (Buffer.byteLength(serialized ?? "") > MAX_CONFIG_BYTES) {
		state.add("root", `Document exceeds ${MAX_CONFIG_BYTES} bytes.`);
	}
	if (!isRecord(document)) {
		state.add("root", "Must be an object.");
		return state.result({});
	}
	allowedKeys(document, new Set(["providers"]), "root", state);
	if (!isRecord(document.providers)) {
		state.add("providers", "Field is required and must be an object.");
		return state.result(document);
	}
	const entries = Object.entries(document.providers);
	if (entries.length > 128) {
		state.add("providers", "May contain at most 128 providers.");
	}
	for (const [id, definition] of entries.slice(0, 128)) {
		if (!PROVIDER_PATTERN.test(id)) {
			state.add("providers", "Provider id is invalid.");
			continue;
		}
		provider(definition, `providers.${id}`, state);
	}
	return state.result(document);
}

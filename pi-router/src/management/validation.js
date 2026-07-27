import { RouterError, invalidRequest, notFound } from "../errors.js";

export const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
export const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/u;

export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(value, message = "Request body must be a JSON object.") {
	if (!isRecord(value)) {
		throw invalidRequest(message);
	}
	return value;
}

export function exactKeys(value, allowed, message = "Request body contains unsupported fields.") {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw invalidRequest(message, "unsupported_field");
		}
	}
}

export function boundedString(value, name, {
	min = 1,
	max = 256,
	trim = true,
	code = "invalid_request",
} = {}) {
	if (typeof value !== "string") {
		throw invalidRequest(`${name} must be a string.`, code);
	}
	const selected = trim ? value.trim() : value;
	if (selected.length < min || selected.length > max) {
		throw invalidRequest(`${name} must be between ${min} and ${max} characters.`, code);
	}
	return selected;
}

export function providerId(value) {
	const selected = boundedString(value, "provider_id", {
		max: 64,
		code: "invalid_provider",
	});
	if (!PROVIDER_ID_PATTERN.test(selected)) {
		throw invalidRequest(
			"provider_id must contain only letters, numbers, dot, underscore, or hyphen.",
			"invalid_provider",
		);
	}
	return selected;
}

export function sessionId(value) {
	if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) {
		throw notFound();
	}
	return value;
}

export function conflict(message, code) {
	return new RouterError(message, {
		status: 409,
		code,
		type: "invalid_request_error",
	});
}

export function unavailable(message, code) {
	return new RouterError(message, {
		status: 503,
		code,
		type: "server_error",
	});
}

export function safeText(value, max = 160, fallback = "") {
	if (typeof value !== "string") {
		return fallback;
	}
	const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
	return normalized.slice(0, max) || fallback;
}

export function safeIdentity(value, max = 96) {
	const text = safeText(value, max, "");
	if (!text || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(text)) {
		return undefined;
	}
	return text;
}

export function boundedInteger(value, name, {
	min = 0,
	max = Number.MAX_SAFE_INTEGER,
	defaultValue,
} = {}) {
	if (value === undefined && defaultValue !== undefined) {
		return defaultValue;
	}
	const selected = typeof value === "string" && value.trim() !== ""
		? Number(value)
		: value;
	if (!Number.isSafeInteger(selected) || selected < min || selected > max) {
		throw invalidRequest(`${name} must be an integer from ${min} to ${max}.`);
	}
	return selected;
}

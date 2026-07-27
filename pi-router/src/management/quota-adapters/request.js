const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 256 * 1024;

function headerValue(headers, name) {
	if (!headers || typeof headers !== "object") {
		return undefined;
	}
	const match = Object.entries(headers)
		.find(([key]) => key.toLowerCase() === name.toLowerCase());
	return typeof match?.[1] === "string" ? match[1] : undefined;
}

export function bearerToken(resolved) {
	const auth = resolved?.auth;
	if (!auth || typeof auth !== "object") {
		throw new Error("OAuth credential is unavailable");
	}
	if (typeof auth.apiKey === "string" && auth.apiKey.length > 0) {
		return auth.apiKey;
	}
	const authorization = headerValue(auth.headers, "authorization");
	if (authorization?.startsWith("Bearer ")) {
		return authorization.slice("Bearer ".length);
	}
	throw new Error("OAuth bearer is unavailable");
}

export function jwtClaims(token) {
	if (typeof token !== "string") {
		return undefined;
	}
	const parts = token.split(".");
	if (parts.length < 2) {
		return undefined;
	}
	try {
		const value = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

async function boundedText(response, maxBytes) {
	const declared = Number(response.headers?.get?.("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new Error("Quota response is too large");
	}
	if (!response.body?.getReader) {
		const text = await response.text();
		if (Buffer.byteLength(text) > maxBytes) {
			throw new Error("Quota response is too large");
		}
		return text;
	}
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			total += value.byteLength;
			if (total > maxBytes) {
				throw new Error("Quota response is too large");
			}
			chunks.push(Buffer.from(value));
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	return Buffer.concat(chunks).toString("utf8");
}

export async function requestJson({
	url,
	token,
	method = "GET",
	headers = {},
	body,
	fetchImpl = fetch,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
	const timeout = AbortSignal.timeout(timeoutMs);
	const response = await fetchImpl(url, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/json",
			...headers,
		},
		body,
		redirect: "error",
		signal: timeout,
	});
	if (!response || !Number.isInteger(response.status)) {
		throw new Error("Quota request returned no HTTP response");
	}
	if (response.status < 200 || response.status >= 300) {
		await response.body?.cancel?.().catch(() => {});
		throw new Error(`Quota request failed with HTTP ${response.status}`);
	}
	const text = await boundedText(response, maxBytes);
	try {
		const value = JSON.parse(text);
		if (!value || typeof value !== "object") {
			throw new Error();
		}
		return value;
	} catch {
		throw new Error("Quota response is not valid JSON");
	}
}

export function number(value) {
	const selected = typeof value === "string" && value.trim() ? Number(value) : value;
	return Number.isFinite(selected) ? selected : undefined;
}

export function resetsAt(value, now = Date.now) {
	if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
		return new Date(value).toISOString();
	}
	const numeric = number(value);
	if (numeric === undefined) {
		return undefined;
	}
	const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
	const absolute = milliseconds > now() ? milliseconds : now() + milliseconds;
	return new Date(absolute).toISOString();
}

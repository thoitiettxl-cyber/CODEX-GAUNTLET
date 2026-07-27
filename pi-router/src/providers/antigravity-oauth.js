import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const CALLBACK_PORT = 51121;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth-callback`;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo?alt=json";
const LOAD_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const ONBOARD_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser";
const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];
const MAX_RESPONSE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function requestSignal(signal) {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function randomState() {
	return randomBytes(32).toString("base64url");
}

function projectId(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	for (const key of ["cloudaicompanionProject", "projectId", "project"]) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim();
		}
		if (
			candidate
			&& typeof candidate === "object"
			&& typeof candidate.id === "string"
			&& candidate.id.trim()
		) {
			return candidate.id.trim();
		}
	}
	return undefined;
}

async function responseJson(response, operation) {
	if (!response.ok) {
		await response.body?.cancel?.().catch(() => {});
		throw new Error(`Antigravity ${operation} failed with HTTP ${response.status}`);
	}
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
		throw new Error(`Antigravity ${operation} response is too large`);
	}
	let bytes;
	if (!response.body?.getReader) {
		const text = await response.text();
		bytes = Buffer.from(text);
	} else {
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
				if (total > MAX_RESPONSE_BYTES) {
					throw new Error(`Antigravity ${operation} response is too large`);
				}
				chunks.push(Buffer.from(value));
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		bytes = Buffer.concat(chunks);
	}
	if (bytes.length > MAX_RESPONSE_BYTES) {
		throw new Error(`Antigravity ${operation} response is too large`);
	}
	try {
		const value = JSON.parse(bytes.toString("utf8"));
		if (!value || typeof value !== "object") {
			throw new Error();
		}
		return value;
	} catch {
		throw new Error(`Antigravity ${operation} response is invalid`);
	}
}

async function requestToken({
	clientId,
	clientSecret,
	code,
	refreshToken,
	fetchImpl,
	signal,
} = {}) {
	const form = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		grant_type: code ? "authorization_code" : "refresh_token",
	});
	if (code) {
		form.set("code", code);
		form.set("redirect_uri", REDIRECT_URI);
	} else {
		form.set("refresh_token", refreshToken);
	}
	const response = await fetchImpl(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: form,
		redirect: "error",
		signal: requestSignal(signal),
	});
	const payload = await responseJson(response, "token exchange");
	if (
		typeof payload.access_token !== "string"
		|| typeof payload.expires_in !== "number"
		|| (code && typeof payload.refresh_token !== "string")
	) {
		throw new Error("Antigravity token response is incomplete");
	}
	return {
		access: payload.access_token,
		refresh: payload.refresh_token ?? refreshToken,
		expires: Date.now() + payload.expires_in * 1000 - 5 * 60 * 1000,
	};
}

async function userEmail(token, fetchImpl, signal) {
	const response = await fetchImpl(USERINFO_URL, {
		headers: { authorization: `Bearer ${token}`, "user-agent": "pi-router" },
		redirect: "error",
		signal: requestSignal(signal),
	});
	const payload = await responseJson(response, "profile request");
	if (typeof payload.email !== "string" || !payload.email.trim()) {
		throw new Error("Antigravity profile has no email");
	}
	return payload.email.trim();
}

async function controlPlane(url, token, body, fetchImpl, signal) {
	const response = await fetchImpl(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/json",
			"content-type": "application/json",
			"user-agent": "pi-router",
		},
		body: JSON.stringify(body),
		redirect: "error",
		signal: requestSignal(signal),
	});
	return responseJson(response, "control-plane request");
}

async function discoverProject(token, fetchImpl, signal) {
	const loaded = await controlPlane(
		LOAD_URL,
		token,
		{ metadata: { ideType: "ANTIGRAVITY" } },
		fetchImpl,
		signal,
	);
	const existing = projectId(loaded);
	if (existing) {
		return existing;
	}
	const tiers = Array.isArray(loaded.allowedTiers) ? loaded.allowedTiers : [];
	const tier = tiers.find((entry) => entry?.isDefault)?.id
		?? loaded.currentTier?.id
		?? "free-tier";
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const onboarded = await controlPlane(
			ONBOARD_URL,
			token,
			{
				tier_id: tier,
				metadata: {
					ide_type: "ANTIGRAVITY",
					ide_name: "antigravity",
					ide_version: "1.0.13",
				},
			},
			fetchImpl,
			signal,
		);
		const found = projectId(onboarded.response) ?? projectId(onboarded);
		if (found) {
			return found;
		}
		if (onboarded.done !== true) {
			await new Promise((resolve, reject) => {
				const onAbort = () => {
					clearTimeout(timeout);
					reject(new Error("Antigravity login cancelled"));
				};
				const timeout = setTimeout(() => {
					signal?.removeEventListener("abort", onAbort);
					resolve();
				}, 2_000);
				if (signal?.aborted) {
					onAbort();
				} else {
					signal?.addEventListener("abort", onAbort, { once: true });
				}
			});
		}
	}
	throw new Error("Antigravity project discovery did not complete");
}

function callbackServer() {
	let resolveResult;
	let rejectResult;
	const resultPromise = new Promise((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});
	let settled = false;
	const server = createServer((request, response) => {
			const url = new URL(request.url ?? "/", REDIRECT_URI);
			if (url.pathname !== "/oauth-callback") {
				response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
				response.end("Not found");
				return;
			}
			const result = {
				code: url.searchParams.get("code"),
				state: url.searchParams.get("state"),
				error: url.searchParams.get("error"),
			};
			response.writeHead(result.code ? 200 : 400, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			response.end(
				result.code
					? "<h1>Login complete</h1><p>You may close this page.</p>"
					: "<h1>Login failed</h1><p>Return to Pi Router.</p>",
			);
			if (!settled) {
				settled = true;
				resolveResult(result);
			}
		});
	server.once("error", (error) => {
		if (!settled) {
			settled = true;
			rejectResult(error);
		}
	});
	server.listen(CALLBACK_PORT, "127.0.0.1");
	return { server, result: resultPromise };
}

function manualCallback(value) {
	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code"),
			state: url.searchParams.get("state"),
			error: url.searchParams.get("error"),
		};
	} catch {
		throw new Error("Paste the complete Antigravity callback URL");
	}
}

async function authorizationCode(callbacks, clientId) {
	const state = randomState();
	const url = new URL(AUTH_URL);
	url.searchParams.set("access_type", "offline");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("prompt", "consent");
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", SCOPES.join(" "));
	url.searchParams.set("state", state);

	let callback;
	try {
		callback = callbackServer();
	} catch {
		callback = undefined;
	}
	callbacks.onAuth({
		url: url.href,
		instructions: "Open the Antigravity sign-in page. If callback handling fails, paste its full URL.",
	});
	const manualPromise = callbacks.onManualCodeInput()
		.then(manualCallback);
	let winner;
	try {
		winner = await Promise.race([
			...(callback
				? [callback.result.catch(() => new Promise(() => {}))]
				: []),
			manualPromise,
		]);
	} finally {
		callback?.server.close();
	}
	if (winner.error) {
		throw new Error("Antigravity authorization was denied");
	}
	if (winner.state !== state || !winner.code) {
		throw new Error("Antigravity callback state or code is invalid");
	}
	return winner.code;
}

export function createAntigravityProviderConfig({
	clientId,
	clientSecret,
	fetchImpl = fetch,
} = {}) {
	if (!clientId || !clientSecret) {
		return undefined;
	}
	return {
		name: "Antigravity",
		baseUrl: "https://cloudcode-pa.googleapis.com",
		api: "google-generative-ai",
		authHeader: true,
		oauth: {
			name: "Antigravity",
			async login(callbacks) {
				const code = await authorizationCode(callbacks, clientId);
				callbacks.onProgress("Exchanging Antigravity authorization code...");
				const tokens = await requestToken({
					clientId,
					clientSecret,
					code,
					fetchImpl,
					signal: callbacks.signal,
				});
				const [email, foundProjectId] = await Promise.all([
					userEmail(tokens.access, fetchImpl, callbacks.signal),
					discoverProject(tokens.access, fetchImpl, callbacks.signal),
				]);
				return {
					...tokens,
					email,
					projectId: foundProjectId,
				};
			},
			refreshToken(credentials) {
				return requestToken({
					clientId,
					clientSecret,
					refreshToken: credentials.refresh,
					fetchImpl,
				}).then((tokens) => ({
					...tokens,
					email: credentials.email,
					projectId: credentials.projectId,
				}));
			},
			getApiKey(credentials) {
				return credentials.access;
			},
		},
	};
}

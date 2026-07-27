import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import {
	RouterError,
	errorEnvelope,
	notFound,
	safeError,
	unauthorized,
} from "./errors.js";
import {
	anthropicRequestToPi,
	anthropicSseFrame,
	collectAnthropicMessage,
	translateAnthropicStream,
} from "./anthropic-messages.js";
import {
	chatRequestToPi,
	chatSseFrame,
	collectChatCompletion,
	translateChatStream,
} from "./chat-completions.js";
import {
	createManagementService,
	OperationalEventLog,
} from "./management/index.js";
import { routeManagement } from "./management/routes.js";
import { publicModel } from "./pi-runtime.js";
import { collectResponse, requestToPi, sseFrame, translatePiStream } from "./responses.js";
import { GithubUpdateManager } from "./update.js";
import { VERSION } from "./version.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const MANAGEMENT_HTML = typeof __PI_ROUTER_MANAGEMENT_HTML__ === "string"
	? __PI_ROUTER_MANAGEMENT_HTML__
	: readFileSync(new URL("../web/dist/index.html", import.meta.url), "utf8");

function inlineSourceHash(tag, html) {
	const match = html.match(
		new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu"),
	);
	if (!match) {
		throw new Error(`Pi Router management HTML has no inline ${tag}.`);
	}
	const source = match[1];
	return `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
}

const MANAGEMENT_SCRIPT_HASH = inlineSourceHash("script", MANAGEMENT_HTML);
const MANAGEMENT_STYLE_HASH = inlineSourceHash("style", MANAGEMENT_HTML);

function managementCsp(nonce) {
	return [
		"default-src 'none'",
		`script-src ${MANAGEMENT_SCRIPT_HASH}`,
		"script-src-attr 'none'",
		`style-src ${MANAGEMENT_STYLE_HASH} 'nonce-${nonce}'`,
		"style-src-attr 'none'",
		"connect-src 'self' http: https:",
		"img-src data:",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	].join("; ");
}

function json(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		"cache-control": "no-store",
	});
	response.end(payload);
}

function managementHtml(response, method) {
	const nonce = randomBytes(18).toString("base64");
	const html = MANAGEMENT_HTML.replaceAll("__PI_ROUTER_CSP_NONCE__", nonce);
	response.writeHead(200, {
		"content-type": "text/html; charset=utf-8",
		"content-length": Buffer.byteLength(html),
		"cache-control": "no-store",
		"content-security-policy": managementCsp(nonce),
		"cross-origin-opener-policy": "same-origin",
		"permissions-policy": "camera=(), geolocation=(), microphone=()",
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
		"x-frame-options": "DENY",
	});
	response.end(method === "HEAD" ? undefined : html);
}

function digest(value) {
	return createHash("sha256").update(value).digest();
}

export function bearerAuthorized(header, expectedKey) {
	if (
		typeof expectedKey !== "string"
		|| expectedKey.length === 0
		|| typeof header !== "string"
		|| !header.startsWith("Bearer ")
	) {
		return false;
	}
	const supplied = header.slice("Bearer ".length);
	return timingSafeEqual(digest(supplied), digest(expectedKey));
}

function bearerValue(header) {
	return typeof header === "string" && header.startsWith("Bearer ")
		? header.slice("Bearer ".length)
		: undefined;
}

export function validateListenHost(host, { allowRemote = false } = {}) {
	if (
		typeof host !== "string"
		|| host.length === 0
		|| host.length > 255
		|| (!allowRemote && !LOOPBACK_HOSTS.has(host))
	) {
		throw new RouterError("Pi Router may listen only on 127.0.0.1 or ::1.", {
			status: 400,
			code: "non_loopback_host",
			type: "invalid_request_error",
		});
	}
	return host;
}

async function readBody(request, maxBodyBytes) {
	const declaredLength = Number(request.headers["content-length"]);
	if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
		throw new RouterError("Request body is too large.", {
			status: 413,
			code: "request_too_large",
			type: "invalid_request_error",
		});
	}
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > maxBodyBytes) {
			throw new RouterError("Request body is too large.", {
				status: 413,
				code: "request_too_large",
				type: "invalid_request_error",
			});
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

async function readJson(request, maxBodyBytes) {
	try {
		return JSON.parse((await readBody(request, maxBodyBytes)).toString("utf8"));
	} catch {
		throw new RouterError("Request body must be valid JSON.", {
			status: 400,
			code: "invalid_json",
			type: "invalid_request_error",
		});
	}
}

async function readText(request, maxBodyBytes) {
	return (await readBody(request, maxBodyBytes)).toString("utf8");
}

function raw(response, status, body, headers = {}) {
	const payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
	response.writeHead(status, {
		"content-length": payload.length,
		"cache-control": "no-store",
		...headers,
	});
	response.end(payload);
}

function requireManagementAuth(request, managementKey) {
	if (!bearerAuthorized(request.headers.authorization, managementKey)) {
		throw unauthorized();
	}
}

function requireProxyAuth(request, proxyKeyStore) {
	const value = bearerValue(request.headers.authorization);
	if (!value || !proxyKeyStore.authorize(value)) {
		throw unauthorized();
	}
}

function healthBody() {
	return {
		status: "ok",
		service: "pi-router",
		version: VERSION,
	};
}

async function writeSse(response, event, frame = sseFrame) {
	if (response.write(frame(event))) {
		return;
	}
	await new Promise((resolve) => {
		const settled = () => {
			response.off("drain", settled);
			response.off("close", settled);
			resolve();
		};
		response.once("drain", settled);
		response.once("close", settled);
	});
}

function inferenceStream(request, response, options, model, converted) {
	request.piRouterEvent.model = `${model.provider}/${model.id}`;
	request.piRouterEvent.provider = model.provider;
	const abortController = new AbortController();
	request.once("aborted", () => abortController.abort());
	response.once("close", () => {
		if (!response.writableEnded) {
			abortController.abort();
		}
	});
	converted.options.signal = abortController.signal;
	return options.runtime.stream(model, converted.context, converted.options);
}

async function routeRequest(request, response, options) {
	const url = new URL(request.url ?? "/", "http://pi-router.local");
	if (
		["GET", "HEAD"].includes(request.method ?? "")
		&& ["/", "/management.html"].includes(url.pathname)
	) {
		managementHtml(response, request.method);
		return;
	}
	if (request.method === "GET" && url.pathname === "/health") {
		json(response, 200, healthBody());
		return;
	}

	if (
		url.pathname.startsWith("/management/api/")
		|| url.pathname.startsWith("/v0/management/")
	) {
		requireManagementAuth(request, options.managementKey);
	} else if (url.pathname.startsWith("/v1/")) {
		requireProxyAuth(request, options.proxyKeyStore);
	}

	if (
		(
			url.pathname.startsWith("/management/api/")
			|| url.pathname.startsWith("/v0/management/")
		)
		&& await routeManagement({
		request,
		response,
		url,
		management: options.management,
		readJson,
		readText,
		json,
		raw,
		maxBodyBytes: options.maxBodyBytes,
		})
	) {
		return;
	}

	if (request.method === "GET" && url.pathname === "/v1/models") {
		const models = await options.runtime.listModels();
		json(response, 200, {
			object: "list",
			data: models.map(publicModel),
		});
		return;
	}

	if (request.method === "POST" && url.pathname === "/v1/responses") {
		const body = await readJson(request, options.maxBodyBytes);
		const model = await options.runtime.resolveModel(body.model);
		const converted = requestToPi(body, model, options.now());
		const piStream = inferenceStream(request, response, options, model, converted);
		const events = translatePiStream(piStream, {
			body,
			modelName: `${model.provider}/${model.id}`,
			now: options.now(),
		});

		if (body.stream === true) {
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-store",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			for await (const event of events) {
				if (response.destroyed) {
					break;
				}
				await writeSse(response, event);
			}
			if (!response.destroyed) {
				response.end();
			}
			return;
		}

		const result = await collectResponse(events);
		json(response, 200, result);
		return;
	}

	if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
		const body = await readJson(request, options.maxBodyBytes);
		const model = await options.runtime.resolveModel(body.model);
		const converted = chatRequestToPi(body, model, options.now());
		const piStream = inferenceStream(request, response, options, model, converted);
		const modelName = `${model.provider}/${model.id}`;
		if (body.stream === true) {
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-store",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			for await (const chunk of translateChatStream(piStream, {
				body,
				modelName,
				now: options.now(),
			})) {
				if (response.destroyed) {
					break;
				}
				await writeSse(response, chunk, chatSseFrame);
			}
			if (!response.destroyed) {
				response.end("data: [DONE]\n\n");
			}
			return;
		}
		json(response, 200, await collectChatCompletion(piStream, {
			modelName,
			now: options.now(),
		}));
		return;
	}

	if (request.method === "POST" && url.pathname === "/v1/messages") {
		const body = await readJson(request, options.maxBodyBytes);
		const model = await options.runtime.resolveModel(body.model);
		const converted = anthropicRequestToPi(body, model, options.now());
		const piStream = inferenceStream(request, response, options, model, converted);
		const modelName = `${model.provider}/${model.id}`;
		if (body.stream === true) {
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-store",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			for await (const event of translateAnthropicStream(piStream, {
				modelName,
				now: options.now(),
			})) {
				if (response.destroyed) {
					break;
				}
				await writeSse(response, event, anthropicSseFrame);
			}
			if (!response.destroyed) {
				response.end();
			}
			return;
		}
		json(response, 200, await collectAnthropicMessage(piStream, {
			modelName,
			now: options.now(),
		}));
		return;
	}

	throw notFound();
}

export function createPiRouterServer({
	runtime,
	managementKey,
	proxyKeyStore,
	account = "default",
	updater = new GithubUpdateManager(),
	management,
	modelsPath,
	configPath,
	providerPolicyPath,
	quotaAdapters,
	authSessionOptions,
	maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
	now = Date.now,
	requestLogging = true,
	eventLog = new OperationalEventLog({ now, enabled: requestLogging }),
} = {}) {
	if (!runtime) {
		throw new TypeError("runtime is required");
	}
	if (typeof managementKey !== "string" || managementKey.trim().length === 0) {
		throw new RouterError("PI_ROUTER_MANAGEMENT_KEY is required.", {
			status: 500,
			code: "missing_management_key",
			expose: true,
		});
	}
	if (
		!proxyKeyStore
		|| typeof proxyKeyStore.authorize !== "function"
		|| typeof proxyKeyStore.count !== "function"
		|| proxyKeyStore.count() < 1
	) {
		throw new RouterError("At least one proxy API key is required.", {
			status: 500,
			code: "missing_proxy_api_key",
			expose: true,
		});
	}
	if (proxyKeyStore.authorize(managementKey)) {
		throw new RouterError(
			"PI_ROUTER_MANAGEMENT_KEY must differ from every proxy API key.",
			{
				status: 500,
				code: "management_proxy_key_collision",
				expose: true,
			},
		);
	}

	const managementService = management ?? createManagementService({
		runtime,
		account,
		updater,
		modelsPath,
		configPath,
		providerPolicyPath,
		startedAt: now(),
		now,
		eventLog,
		quotaAdapters,
		authSessionOptions,
		proxyKeyStore,
	});
	const options = {
		runtime,
		managementKey,
		proxyKeyStore,
		management: managementService,
		maxBodyBytes,
		now,
	};
	return createServer((request, response) => {
		const startedAt = now();
		let pathname = "/";
		try {
			pathname = new URL(request.url ?? "/", "http://pi-router.local").pathname;
		} catch {
			pathname = "/invalid";
		}
		request.piRouterEvent = {
			requestClass: eventLog.classify(request.method ?? "", pathname),
		};
		let recorded = false;
		const recordEvent = () => {
			if (recorded) {
				return;
			}
			recorded = true;
			eventLog.record({
				...request.piRouterEvent,
				status: response.statusCode,
				durationMs: now() - startedAt,
			});
		};
		response.once("finish", recordEvent);
		response.once("close", recordEvent);
		void routeRequest(request, response, options).catch((error) => {
			const safe = safeError(error);
			request.piRouterEvent.errorCode = safe.code;
			if (response.headersSent || response.destroyed) {
				response.destroy();
				return;
			}
			let pathname = "";
			try {
				pathname = new URL(request.url ?? "/", "http://pi-router.local").pathname;
			} catch {}
			if (pathname === "/v1/messages") {
				json(response, safe.status, {
					type: "error",
					error: {
						type: safe.type === "authentication_error"
							? "authentication_error"
							: (
								safe.type === "invalid_request_error"
									? "invalid_request_error"
									: "api_error"
							),
						message: safe.expose ? safe.message : "The provider request failed.",
					},
				});
				return;
			}
			json(response, safe.status, errorEnvelope(safe));
		});
	});
}

export async function listenPiRouter(
	server,
	{ host = "127.0.0.1", port = 8318, allowRemote = false } = {},
) {
	validateListenHost(host, { allowRemote });
	if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
		throw new RouterError("Port must be an integer from 0 to 65535.", {
			status: 400,
			code: "invalid_port",
			type: "invalid_request_error",
		});
	}
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return server.address();
}

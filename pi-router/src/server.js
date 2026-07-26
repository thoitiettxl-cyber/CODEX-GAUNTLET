import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { RouterError, errorEnvelope, notFound, safeError, unauthorized } from "./errors.js";
import { publicModel } from "./pi-runtime.js";
import { collectResponse, requestToPi, sseFrame, translatePiStream } from "./responses.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function json(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		"cache-control": "no-store",
	});
	response.end(payload);
}

function digest(value) {
	return createHash("sha256").update(value).digest();
}

export function bearerAuthorized(header, expectedKey) {
	if (typeof header !== "string" || !header.startsWith("Bearer ")) {
		return false;
	}
	const supplied = header.slice("Bearer ".length);
	return timingSafeEqual(digest(supplied), digest(expectedKey));
}

export function validateListenHost(host) {
	if (!LOOPBACK_HOSTS.has(host)) {
		throw new RouterError("Pi Router may listen only on 127.0.0.1 or ::1.", {
			status: 400,
			code: "non_loopback_host",
			type: "invalid_request_error",
		});
	}
	return host;
}

async function readJson(request, maxBodyBytes) {
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
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new RouterError("Request body must be valid JSON.", {
			status: 400,
			code: "invalid_json",
			type: "invalid_request_error",
		});
	}
}

function requireAuth(request, apiKey) {
	if (!bearerAuthorized(request.headers.authorization, apiKey)) {
		throw unauthorized();
	}
}

function healthBody() {
	return {
		status: "ok",
		service: "pi-router",
		version: "0.1.0",
	};
}

async function writeSse(response, event) {
	if (response.write(sseFrame(event))) {
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

async function routeRequest(request, response, options) {
	const url = new URL(request.url ?? "/", "http://pi-router.local");
	if (request.method === "GET" && url.pathname === "/health") {
		json(response, 200, healthBody());
		return;
	}

	if (url.pathname.startsWith("/v1/")) {
		requireAuth(request, options.apiKey);
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
		const abortController = new AbortController();
		request.once("aborted", () => abortController.abort());
		response.once("close", () => {
			if (!response.writableEnded) {
				abortController.abort();
			}
		});
		converted.options.signal = abortController.signal;
		const piStream = options.runtime.stream(model, converted.context, converted.options);
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

	throw notFound();
}

export function createPiRouterServer({
	runtime,
	apiKey,
	maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
	now = Date.now,
} = {}) {
	if (!runtime) {
		throw new TypeError("runtime is required");
	}
	if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
		throw new RouterError("PI_ROUTER_API_KEY is required.", {
			status: 500,
			code: "missing_api_key",
			expose: true,
		});
	}

	const options = { runtime, apiKey, maxBodyBytes, now };
	return createServer((request, response) => {
		void routeRequest(request, response, options).catch((error) => {
			if (response.headersSent || response.destroyed) {
				response.destroy();
				return;
			}
			const safe = safeError(error);
			json(response, safe.status, errorEnvelope(safe));
		});
	});
}

export async function listenPiRouter(server, { host = "127.0.0.1", port = 8318 } = {}) {
	validateListenHost(host);
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

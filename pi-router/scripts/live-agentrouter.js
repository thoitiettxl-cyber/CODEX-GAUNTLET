import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { PiRuntime } from "../src/pi-runtime.js";
import { createPiRouterServer, listenPiRouter } from "../src/server.js";

// This script is intentionally outside the deterministic test runner.
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const modelsPath = join(packageRoot, "examples", "models.agentrouter.json");
const DEFAULT_TIMEOUT_MS = 180_000;
const providerId = "agentrouter";
const tool = {
	type: "function",
	name: "weather_probe",
	description: "Return a deterministic live-test value for a city.",
	parameters: {
		type: "object",
		properties: { city: { type: "string" } },
		required: ["city"],
		additionalProperties: false,
	},
	strict: true,
};

function positiveInteger(value, fallback) {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error("PI_ROUTER_LIVE_TIMEOUT_MS must be a positive integer.");
	}
	return parsed;
}

function safeText(value) {
	return String(value ?? "")
		.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/giu, "Bearer [redacted]")
		.replace(/sk-[A-Za-z0-9_-]+/gu, "sk-[redacted]")
		.replace(/[\r\n\t]+/gu, " ")
		.slice(0, 240);
}

function responseText(body) {
	return (body.output ?? [])
		.flatMap((item) => item.content ?? [])
		.filter((part) => part.type === "output_text")
		.map((part) => part.text)
		.join("");
}

function errorSummary(body) {
	if (!body?.error) {
		return undefined;
	}
	return {
		code: body.error.code,
		message: safeText(body.error.message),
	};
}

function parseSse(payload) {
	const events = [];
	for (const frame of payload.split(/\r?\n\r?\n/gu)) {
		const data = frame
			.split(/\r?\n/gu)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).trim())
			.join("\n");
		if (data) {
			events.push(JSON.parse(data));
		}
	}
	return events;
}

function inMemoryCredentialStore() {
	return {
		async read() {
			return undefined;
		},
		async list() {
			return [];
		},
		async modify(_providerId, update) {
			return update(undefined);
		},
		async delete() {},
	};
}

function inMemoryModelsStore() {
	const entries = new Map();
	return {
		async read(id) {
			return entries.get(id);
		},
		async write(id, value) {
			entries.set(id, structuredClone(value));
		},
		async delete(id) {
			entries.delete(id);
		},
	};
}

function selectedModels(available) {
	const configured = process.env.PI_ROUTER_LIVE_MODELS;
	if (!configured) {
		return available;
	}
	const requested = configured
		.split(",")
		.map((value) => value.trim().replace(/^agentrouter\//u, ""))
		.filter(Boolean);
	const known = new Set(available.map((model) => model.id));
	for (const id of requested) {
		if (!known.has(id)) {
			throw new Error(`Unknown AgentRouter live-test model '${id}'.`);
		}
	}
	return requested.map((id) => available.find((model) => model.id === id));
}

async function main() {
	let upstreamKey = process.env.AGENTROUTER_API_KEY;
	if (!upstreamKey) {
		throw new Error("AGENTROUTER_API_KEY is required for the opt-in live test.");
	}
	delete process.env.AGENTROUTER_API_KEY;
	process.env.PI_OFFLINE = "1";
	const timeoutMs = positiveInteger(process.env.PI_ROUTER_LIVE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
	const failures = [];
	const record = (testName, pass, details = {}) => {
		const result = { test: testName, pass, ...details };
		process.stdout.write(`${JSON.stringify(result)}\n`);
		if (!pass) {
			failures.push(testName);
		}
	};

	const upstream = await ModelRuntime.create({
		credentials: inMemoryCredentialStore(),
		modelsPath,
		modelsStore: inMemoryModelsStore(),
		allowModelNetwork: false,
	});
	await upstream.setRuntimeApiKey(providerId, upstreamKey, { allowNetwork: false });
	upstreamKey = undefined;

	const available = selectedModels(
		(await upstream.getAvailable(providerId))
			.filter((model) => model.provider === providerId),
	);
	if (available.length === 0) {
		throw new Error("The AgentRouter example exposed no authenticated models.");
	}

	const localKey = randomBytes(24).toString("base64url");
	const server = createPiRouterServer({
		runtime: new PiRuntime(upstream),
		apiKey: localKey,
	});
	const address = await listenPiRouter(server, { host: "127.0.0.1", port: 0 });
	const baseUrl = `http://127.0.0.1:${address.port}`;

	const request = async (path, { authenticated = true, ...options } = {}) => {
		const headers = { ...(options.headers ?? {}) };
		if (authenticated) {
			headers.authorization = `Bearer ${localKey}`;
		}
		return fetch(`${baseUrl}${path}`, {
			...options,
			headers,
			signal: AbortSignal.timeout(timeoutMs),
		});
	};
	const postJson = async (body) => {
		const response = await request("/v1/responses", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		return { response, body: await response.json() };
	};

	try {
		const healthResponse = await request("/health", { authenticated: false });
		const health = await healthResponse.json();
		record("health", healthResponse.status === 200 && health.status === "ok", {
			http: healthResponse.status,
		});

		const unauthorized = await request("/v1/models", { authenticated: false });
		record("local-auth", unauthorized.status === 401, { http: unauthorized.status });

		const catalogResponse = await request("/v1/models");
		const catalog = await catalogResponse.json();
		const catalogIds = new Set((catalog.data ?? []).map((model) => model.id));
		record(
			"models",
			catalogResponse.status === 200
				&& available.every((model) => catalogIds.has(`${providerId}/${model.id}`)),
			{ http: catalogResponse.status, count: available.length },
		);

		for (const model of available) {
			const expected = `TEXT_OK_${model.id}`;
			const started = Date.now();
			try {
				const result = await postJson({
					model: `${providerId}/${model.id}`,
					input: `Reply with exactly ${expected}`,
					reasoning: { effort: "minimal" },
					max_output_tokens: 256,
				});
				const text = responseText(result.body).trim();
				record(`text:${model.id}`, result.response.status === 200
					&& result.body.status === "completed"
					&& text === expected, {
					http: result.response.status,
					status: result.body.status,
					ms: Date.now() - started,
					error: errorSummary(result.body),
					...(text === expected ? {} : { output: safeText(text) }),
				});
			} catch (error) {
				record(`text:${model.id}`, false, {
					ms: Date.now() - started,
					error: safeText(error instanceof Error ? error.message : error),
				});
			}
		}

		const representatives = new Map();
		for (const model of available) {
			if (!representatives.has(model.api)) {
				representatives.set(model.api, model);
			}
		}
		for (const [api, model] of representatives) {
			const expected = `SSE_OK_${model.id}`;
			const started = Date.now();
			try {
				const response = await request("/v1/responses", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						model: `${providerId}/${model.id}`,
						input: `Reply with exactly ${expected}`,
						stream: true,
						reasoning: { effort: "minimal" },
						max_output_tokens: 256,
					}),
				});
				const events = parseSse(await response.text());
				const terminal = events.findLast((event) =>
					["response.completed", "response.failed", "response.incomplete"].includes(event.type));
				const text = responseText(terminal?.response).trim();
				const monotonic = events.every((event, index) => event.sequence_number === index);
				record(`sse:${api}`, response.status === 200
					&& response.headers.get("content-type")?.startsWith("text/event-stream")
					&& terminal?.type === "response.completed"
					&& monotonic
					&& text === expected, {
					model: model.id,
					http: response.status,
					terminal: terminal?.type,
					events: events.length,
					ms: Date.now() - started,
					...(text === expected ? {} : { output: safeText(text) }),
				});
			} catch (error) {
				record(`sse:${api}`, false, {
					model: model.id,
					ms: Date.now() - started,
					error: safeText(error instanceof Error ? error.message : error),
				});
			}
		}

		for (const model of available) {
			const user = "Call weather_probe exactly once with city Hue. "
				+ "After its result, reply exactly TOOL_RESULT_OK.";
			const started = Date.now();
			try {
				const first = await postJson({
					model: `${providerId}/${model.id}`,
					instructions: "Follow the function-tool protocol exactly.",
					input: user,
					tools: [tool],
					reasoning: { effort: "minimal" },
					max_output_tokens: 256,
				});
				const functionCall = (first.body.output ?? [])
					.find((item) => item.type === "function_call");
				let argumentsValue;
				try {
					argumentsValue = functionCall ? JSON.parse(functionCall.arguments) : undefined;
				} catch {
					argumentsValue = undefined;
				}
				if (
					first.body.status !== "completed"
					|| functionCall?.name !== tool.name
					|| argumentsValue?.city !== "Hue"
				) {
					record(`tool:${model.id}`, false, {
						phase: "function_call",
						status: first.body.status,
						ms: Date.now() - started,
						error: errorSummary(first.body),
					});
					continue;
				}

				const second = await postJson({
					model: `${providerId}/${model.id}`,
					instructions: "After the function result, reply exactly TOOL_RESULT_OK.",
					input: [
						{ role: "user", content: user },
						functionCall,
						{
							type: "function_call_output",
							call_id: functionCall.call_id,
							output: "TOOL_RESULT_OK",
						},
					],
					tools: [tool],
					reasoning: { effort: "minimal" },
					max_output_tokens: 256,
				});
				const text = responseText(second.body).trim();
				record(`tool:${model.id}`, second.response.status === 200
					&& second.body.status === "completed"
					&& text === "TOOL_RESULT_OK", {
					phase: "round_trip",
					http: second.response.status,
					status: second.body.status,
					ms: Date.now() - started,
					error: errorSummary(second.body),
					...(text === "TOOL_RESULT_OK" ? {} : { output: safeText(text) }),
				});
			} catch (error) {
				record(`tool:${model.id}`, false, {
					phase: "transport",
					ms: Date.now() - started,
					error: safeText(error instanceof Error ? error.message : error),
				});
			}
		}
	} finally {
		await new Promise((resolve) => server.close(resolve));
		await upstream.removeRuntimeApiKey(providerId).catch(() => {});
	}

	if (failures.length > 0) {
		throw new Error(`AgentRouter live test failed: ${failures.join(", ")}`);
	}
	process.stdout.write(`${JSON.stringify({
		test: "summary",
		pass: true,
		models: available.map((model) => model.id),
	})}\n`);
}

try {
	await main();
} catch (error) {
	process.stderr.write(`pi-router live test: ${safeText(error instanceof Error ? error.message : error)}\n`);
	process.exitCode = 1;
}

import { randomUUID } from "node:crypto";

import { invalidRequest } from "./errors.js";

const REASONING_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const ZERO_COST = Object.freeze({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	total: 0,
});

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { ...ZERO_COST },
	};
}

function id(prefix) {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function asText(value, path) {
	if (typeof value !== "string") {
		throw invalidRequest(`${path} must be a string.`);
	}
	return value;
}

function contentToText(content, path, allowedTypes) {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		throw invalidRequest(`${path} must be a string or content array.`);
	}
	return content
		.map((part, index) => {
			if (!part || typeof part !== "object" || !allowedTypes.has(part.type)) {
				throw invalidRequest(`${path}[${index}] has an unsupported content type.`);
			}
			return asText(part.text, `${path}[${index}].text`);
		})
		.join("");
}

function assistantMessage(blocks, model, timestamp) {
	return {
		role: "assistant",
		content: blocks,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage(),
		stopReason: blocks.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
		timestamp,
	};
}

export function requestToPi(body, model, now = Date.now()) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw invalidRequest("Request body must be a JSON object.");
	}
	if (body.stream !== undefined && typeof body.stream !== "boolean") {
		throw invalidRequest("stream must be a boolean.");
	}
	if (body.previous_response_id !== undefined && body.previous_response_id !== null) {
		throw invalidRequest("previous_response_id is not supported by the MVP.");
	}
	if (body.background !== undefined && body.background !== false) {
		throw invalidRequest("background responses are not supported by the MVP.");
	}
	if (body.store !== undefined && body.store !== false) {
		throw invalidRequest("stored responses are not supported by the MVP.");
	}
	if (body.conversation !== undefined && body.conversation !== null) {
		throw invalidRequest("conversation state is not supported by the MVP.");
	}
	if (body.prompt !== undefined && body.prompt !== null) {
		throw invalidRequest("prompt templates are not supported by the MVP.");
	}
	const systemParts = [];
	if (body.instructions !== undefined && body.instructions !== null) {
		systemParts.push(asText(body.instructions, "instructions"));
	}
	const messages = [];
	const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input;
	if (!Array.isArray(input) || input.length === 0) {
		throw invalidRequest("input must be a non-empty string or array.");
	}

	const toolNames = new Map();
	let pendingToolCalls = [];
	const flushToolCalls = () => {
		if (pendingToolCalls.length > 0) {
			messages.push(assistantMessage(pendingToolCalls, model, now));
			pendingToolCalls = [];
		}
	};

	for (const [index, item] of input.entries()) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw invalidRequest(`input[${index}] must be an object.`);
		}
		if (item.type === "function_call") {
			const callId = asText(item.call_id, `input[${index}].call_id`);
			if (toolNames.has(callId)) {
				throw invalidRequest(`input[${index}].call_id must be unique.`);
			}
			const toolName = asText(item.name, `input[${index}].name`);
			let args;
			try {
				args = JSON.parse(asText(item.arguments, `input[${index}].arguments`));
			} catch {
				throw invalidRequest(`input[${index}].arguments must be valid JSON.`);
			}
			if (!args || typeof args !== "object" || Array.isArray(args)) {
				throw invalidRequest(`input[${index}].arguments must decode to an object.`);
			}
			pendingToolCalls.push({
				type: "toolCall",
				id: callId,
				name: toolName,
				arguments: args,
			});
			toolNames.set(callId, toolName);
			continue;
		}

		flushToolCalls();
		if (item.type === "function_call_output") {
			const callId = asText(item.call_id, `input[${index}].call_id`);
			const toolName = toolNames.get(callId);
			if (!toolName) {
				throw invalidRequest(
					`input[${index}] has no matching function_call for '${callId}'.`,
					"orphaned_tool_output",
				);
			}
			messages.push({
				role: "toolResult",
				toolCallId: callId,
				toolName,
				content: [{ type: "text", text: asText(item.output, `input[${index}].output`) }],
				isError: false,
				timestamp: now,
			});
			continue;
		}

		const role = item.role;
		if (!["user", "assistant", "system", "developer"].includes(role)) {
			throw invalidRequest(`input[${index}] has an unsupported item type or role.`);
		}
		const text = contentToText(
			item.content,
			`input[${index}].content`,
			role === "assistant"
				? new Set(["output_text", "text"])
				: new Set(["input_text", "text"]),
		);
		if (role === "system" || role === "developer") {
			systemParts.push(text);
		} else if (role === "user") {
			messages.push({ role: "user", content: text, timestamp: now });
		} else {
			messages.push(assistantMessage([{ type: "text", text }], model, now));
		}
	}
	flushToolCalls();

	const tools = body.tools === undefined ? undefined : normalizeTools(body.tools);
	const reasoning = normalizeReasoning(body.reasoning);
	const maxTokens =
		body.max_output_tokens === undefined || body.max_output_tokens === null
			? undefined
			: normalizePositiveInteger(body.max_output_tokens, "max_output_tokens");

	return {
		context: {
			systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
			messages,
			tools,
		},
		options: {
			reasoning,
			maxTokens,
			signal: undefined,
			transport: "sse",
			sessionId:
				typeof body.prompt_cache_key === "string" && body.prompt_cache_key
					? body.prompt_cache_key
					: undefined,
		},
	};
}

function normalizeTools(tools) {
	if (!Array.isArray(tools)) {
		throw invalidRequest("tools must be an array.");
	}
	return tools.map((tool, index) => {
		if (!tool || typeof tool !== "object" || tool.type !== "function") {
			throw invalidRequest(`tools[${index}] must be a function tool.`);
		}
		const parameters = tool.parameters ?? { type: "object", properties: {} };
		if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
			throw invalidRequest(`tools[${index}].parameters must be a JSON Schema object.`);
		}
		return {
			name: asText(tool.name, `tools[${index}].name`),
			description: typeof tool.description === "string" ? tool.description : "",
			parameters,
			constrainedSampling:
				tool.strict === true ? { type: "json_schema", strict: "require" } : undefined,
		};
	});
}

function normalizeReasoning(reasoning) {
	if (reasoning === undefined || reasoning === null) {
		return undefined;
	}
	if (!reasoning || typeof reasoning !== "object" || Array.isArray(reasoning)) {
		throw invalidRequest("reasoning must be an object.");
	}
	if (reasoning.effort === undefined || reasoning.effort === null) {
		return undefined;
	}
	if (!REASONING_LEVELS.has(reasoning.effort)) {
		throw invalidRequest("reasoning.effort is not supported.");
	}
	return reasoning.effort;
}

function normalizePositiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw invalidRequest(`${path} must be a positive integer.`);
	}
	return value;
}

function usageFromPi(usage) {
	if (!usage) {
		return null;
	}
	return {
		input_tokens: usage.input ?? 0,
		input_tokens_details: {
			cached_tokens: usage.cacheRead ?? 0,
		},
		output_tokens: usage.output ?? 0,
		output_tokens_details: {
			reasoning_tokens: usage.reasoning ?? 0,
		},
		total_tokens: usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0),
	};
}

function clone(value) {
	return structuredClone(value);
}

class ResponseState {
	constructor(body, modelName, now = Date.now()) {
		this.sequence = 0;
		this.text = new Map();
		this.toolCalls = new Set();
		this.response = {
			id: id("resp"),
			object: "response",
			created_at: Math.floor(now / 1000),
			status: "in_progress",
			background: false,
			error: null,
			incomplete_details: null,
			instructions: body.instructions ?? null,
			max_output_tokens: body.max_output_tokens ?? null,
			model: modelName,
			output: [],
			parallel_tool_calls: body.parallel_tool_calls !== false,
			previous_response_id: null,
			reasoning: body.reasoning ?? null,
			store: false,
			temperature: body.temperature ?? null,
			text: body.text ?? { format: { type: "text" } },
			tool_choice: body.tool_choice ?? "auto",
			tools: body.tools ?? [],
			top_p: body.top_p ?? null,
			truncation: body.truncation ?? "disabled",
			usage: null,
			metadata: body.metadata ?? {},
		};
	}

	event(type, fields = {}) {
		return { type, sequence_number: this.sequence++, ...fields };
	}

	responseEvent(type) {
		return this.event(type, { response: clone(this.response) });
	}

	startText(contentIndex) {
		if (this.text.has(contentIndex)) {
			return [];
		}
		const outputIndex = this.response.output.length;
		const itemId = id("msg");
		const part = { type: "output_text", text: "", annotations: [], logprobs: [] };
		const item = {
			id: itemId,
			type: "message",
			status: "in_progress",
			role: "assistant",
			content: [part],
		};
		this.response.output.push(item);
		this.text.set(contentIndex, { outputIndex, itemId, item, part, done: false });
		return [
			this.event("response.output_item.added", {
				output_index: outputIndex,
				item: clone(item),
			}),
			this.event("response.content_part.added", {
				item_id: itemId,
				output_index: outputIndex,
				content_index: 0,
				part: clone(part),
			}),
		];
	}

	textDelta(contentIndex, delta) {
		const events = this.startText(contentIndex);
		const current = this.text.get(contentIndex);
		current.part.text += delta;
		events.push(
			this.event("response.output_text.delta", {
				item_id: current.itemId,
				output_index: current.outputIndex,
				content_index: 0,
				delta,
				logprobs: [],
			}),
		);
		return events;
	}

	endText(contentIndex, content) {
		const events = this.startText(contentIndex);
		const current = this.text.get(contentIndex);
		if (current.done) {
			return events;
		}
		current.part.text = content;
		current.item.status = "completed";
		current.done = true;
		events.push(
			this.event("response.output_text.done", {
				item_id: current.itemId,
				output_index: current.outputIndex,
				content_index: 0,
				text: content,
				logprobs: [],
			}),
			this.event("response.content_part.done", {
				item_id: current.itemId,
				output_index: current.outputIndex,
				content_index: 0,
				part: clone(current.part),
			}),
			this.event("response.output_item.done", {
				output_index: current.outputIndex,
				item: clone(current.item),
			}),
		);
		return events;
	}

	toolCall(toolCall) {
		if (this.toolCalls.has(toolCall.id)) {
			return [];
		}
		this.toolCalls.add(toolCall.id);
		const outputIndex = this.response.output.length;
		const itemId = id("fc");
		const argumentsJson = JSON.stringify(toolCall.arguments ?? {});
		const item = {
			id: itemId,
			type: "function_call",
			status: "completed",
			call_id: toolCall.id,
			name: toolCall.name,
			arguments: argumentsJson,
		};
		this.response.output.push(item);
		return [
			this.event("response.output_item.added", {
				output_index: outputIndex,
				item: { ...clone(item), status: "in_progress", arguments: "" },
			}),
			this.event("response.function_call_arguments.delta", {
				item_id: itemId,
				output_index: outputIndex,
				delta: argumentsJson,
			}),
			this.event("response.function_call_arguments.done", {
				item_id: itemId,
				output_index: outputIndex,
				arguments: argumentsJson,
			}),
			this.event("response.output_item.done", {
				output_index: outputIndex,
				item: clone(item),
			}),
		];
	}

	finish(message, reason) {
		this.response.usage = usageFromPi(message?.usage);
		if (reason === "length") {
			this.response.status = "incomplete";
			this.response.incomplete_details = { reason: "max_output_tokens" };
			return this.responseEvent("response.incomplete");
		}
		this.response.status = "completed";
		return this.responseEvent("response.completed");
	}

	fail() {
		this.response.status = "failed";
		this.response.error = {
			code: "provider_error",
			message: "The provider request failed.",
		};
		return [
			this.event("error", {
				code: "provider_error",
				message: "The provider request failed.",
				param: null,
			}),
			this.responseEvent("response.failed"),
		];
	}
}

function terminalEvent(event) {
	return ["response.completed", "response.failed", "response.incomplete"].includes(event.type);
}

export async function* translatePiStream(piStream, { body, modelName, now = Date.now() }) {
	const state = new ResponseState(body, modelName, now);
	yield state.responseEvent("response.created");
	yield state.responseEvent("response.in_progress");
	let terminal = false;
	try {
		for await (const event of piStream) {
			let output = [];
			switch (event.type) {
				case "text_start":
					output = state.startText(event.contentIndex);
					break;
				case "text_delta":
					output = state.textDelta(event.contentIndex, event.delta);
					break;
				case "text_end":
					output = state.endText(event.contentIndex, event.content);
					break;
				case "toolcall_end":
					output = state.toolCall(event.toolCall);
					break;
				case "done":
					for (const [index, block] of event.message.content.entries()) {
						if (block.type === "text") {
							output.push(...state.endText(index, block.text));
						} else if (block.type === "toolCall") {
							output.push(...state.toolCall(block));
						}
					}
					output.push(state.finish(event.message, event.reason));
					terminal = true;
					break;
				case "error":
					output = state.fail();
					terminal = true;
					break;
				default:
					break;
			}
			for (const responseEvent of output) {
				yield responseEvent;
			}
			if (terminal) {
				return;
			}
		}
	} catch {
		for (const responseEvent of state.fail()) {
			yield responseEvent;
		}
		return;
	}
	if (!terminal) {
		for (const responseEvent of state.fail()) {
			yield responseEvent;
		}
	}
}

export async function collectResponse(events) {
	let response;
	for await (const event of events) {
		if (terminalEvent(event)) {
			response = event.response;
		}
	}
	if (!response) {
		throw new Error("Responses stream ended without a terminal event.");
	}
	return response;
}

export function sseFrame(event) {
	return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

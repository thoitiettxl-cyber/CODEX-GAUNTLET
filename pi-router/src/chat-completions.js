import { randomUUID } from "node:crypto";

import { RouterError, invalidRequest } from "./errors.js";

function text(value, path) {
	if (typeof value !== "string") {
		throw invalidRequest(`${path} must be a string.`);
	}
	return value;
}

function contentText(content, path) {
	if (content === null || content === undefined) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		throw invalidRequest(`${path} must be a string or content array.`);
	}
	return content.map((part, index) => {
		if (
			!part
			|| typeof part !== "object"
			|| !["text", "input_text", "output_text"].includes(part.type)
		) {
			throw invalidRequest(`${path}[${index}] has an unsupported content type.`);
		}
		return text(part.text, `${path}[${index}].text`);
	}).join("");
}

function positiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw invalidRequest(`${path} must be a positive integer.`);
	}
	return value;
}

function assistantMessage(content, model, timestamp) {
	return {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
		timestamp,
	};
}

function normalizeTools(tools) {
	if (tools === undefined) {
		return undefined;
	}
	if (!Array.isArray(tools)) {
		throw invalidRequest("tools must be an array.");
	}
	return tools.map((tool, index) => {
		if (!tool || typeof tool !== "object" || tool.type !== "function") {
			throw invalidRequest(`tools[${index}] must be a function tool.`);
		}
		const definition = tool.function;
		if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
			throw invalidRequest(`tools[${index}].function must be an object.`);
		}
		const parameters = definition.parameters ?? { type: "object", properties: {} };
		if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
			throw invalidRequest(`tools[${index}].function.parameters must be an object.`);
		}
		return {
			name: text(definition.name, `tools[${index}].function.name`),
			description: typeof definition.description === "string" ? definition.description : "",
			parameters,
			constrainedSampling: definition.strict === true
				? { type: "json_schema", strict: "require" }
				: undefined,
		};
	});
}

export function chatRequestToPi(body, model, now = Date.now()) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw invalidRequest("Request body must be a JSON object.");
	}
	if (body.stream !== undefined && typeof body.stream !== "boolean") {
		throw invalidRequest("stream must be a boolean.");
	}
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		throw invalidRequest("messages must be a non-empty array.");
	}
	const system = [];
	const messages = [];
	const toolNames = new Map();
	for (const [index, item] of body.messages.entries()) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw invalidRequest(`messages[${index}] must be an object.`);
		}
		const role = item.role;
		if (role === "system" || role === "developer") {
			system.push(contentText(item.content, `messages[${index}].content`));
			continue;
		}
		if (role === "user") {
			messages.push({
				role: "user",
				content: contentText(item.content, `messages[${index}].content`),
				timestamp: now,
			});
			continue;
		}
		if (role === "assistant") {
			const blocks = [];
			const assistantText = contentText(item.content, `messages[${index}].content`);
			if (assistantText) {
				blocks.push({ type: "text", text: assistantText });
			}
			if (item.tool_calls !== undefined) {
				if (!Array.isArray(item.tool_calls)) {
					throw invalidRequest(`messages[${index}].tool_calls must be an array.`);
				}
				for (const [callIndex, call] of item.tool_calls.entries()) {
					const path = `messages[${index}].tool_calls[${callIndex}]`;
					if (!call || typeof call !== "object" || call.type !== "function") {
						throw invalidRequest(`${path} must be a function call.`);
					}
					const callId = text(call.id, `${path}.id`);
					const name = text(call.function?.name, `${path}.function.name`);
					let args;
					try {
						args = JSON.parse(text(call.function?.arguments, `${path}.function.arguments`));
					} catch {
						throw invalidRequest(`${path}.function.arguments must be valid JSON.`);
					}
					if (!args || typeof args !== "object" || Array.isArray(args)) {
						throw invalidRequest(`${path}.function.arguments must decode to an object.`);
					}
					blocks.push({ type: "toolCall", id: callId, name, arguments: args });
					toolNames.set(callId, name);
				}
			}
			messages.push(assistantMessage(blocks, model, now));
			continue;
		}
		if (role === "tool") {
			const callId = text(item.tool_call_id, `messages[${index}].tool_call_id`);
			const name = toolNames.get(callId);
			if (!name) {
				throw invalidRequest(
					`messages[${index}] has no matching assistant tool call.`,
					"orphaned_tool_output",
				);
			}
			messages.push({
				role: "toolResult",
				toolCallId: callId,
				toolName: name,
				content: [{
					type: "text",
					text: contentText(item.content, `messages[${index}].content`),
				}],
				isError: false,
				timestamp: now,
			});
			continue;
		}
		throw invalidRequest(`messages[${index}].role is not supported.`);
	}
	const maxTokens = body.max_completion_tokens ?? body.max_tokens;
	return {
		context: {
			systemPrompt: system.length > 0 ? system.join("\n\n") : undefined,
			messages,
			tools: normalizeTools(body.tools),
		},
		options: {
			maxTokens: maxTokens === undefined ? undefined : positiveInteger(maxTokens, "max_tokens"),
			reasoning: typeof body.reasoning_effort === "string"
				? body.reasoning_effort
				: undefined,
			signal: undefined,
			transport: "sse",
		},
	};
}

function usage(used) {
	return {
		prompt_tokens: used?.input ?? 0,
		completion_tokens: used?.output ?? 0,
		total_tokens: used?.totalTokens ?? (used?.input ?? 0) + (used?.output ?? 0),
	};
}

function finishReason(reason) {
	if (reason === "length") {
		return "length";
	}
	if (reason === "toolUse") {
		return "tool_calls";
	}
	return "stop";
}

function providerFailure() {
	return new RouterError("The provider request failed.", {
		status: 502,
		code: "provider_error",
		type: "server_error",
		expose: false,
	});
}

function completionMessage(message) {
	const textContent = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
	const toolCalls = message.content
		.filter((block) => block.type === "toolCall")
		.map((block) => ({
			id: block.id,
			type: "function",
			function: {
				name: block.name,
				arguments: JSON.stringify(block.arguments ?? {}),
			},
		}));
	return {
		role: "assistant",
		content: textContent || null,
		...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
	};
}

export async function collectChatCompletion(piStream, {
	modelName,
	now = Date.now(),
} = {}) {
	let terminal;
	try {
		for await (const event of piStream) {
			if (event.type === "error") {
				throw providerFailure();
			}
			if (event.type === "done") {
				terminal = event;
				break;
			}
		}
	} catch (error) {
		if (error instanceof RouterError) {
			throw error;
		}
		throw providerFailure();
	}
	if (!terminal) {
		throw providerFailure();
	}
	return {
		id: `chatcmpl-${randomUUID().replaceAll("-", "")}`,
		object: "chat.completion",
		created: Math.floor(now / 1000),
		model: modelName,
		choices: [{
			index: 0,
			message: completionMessage(terminal.message),
			logprobs: null,
			finish_reason: finishReason(terminal.reason),
		}],
		usage: usage(terminal.message.usage),
	};
}

export async function* translateChatStream(piStream, {
	body,
	modelName,
	now = Date.now(),
} = {}) {
	const id = `chatcmpl-${randomUUID().replaceAll("-", "")}`;
	const created = Math.floor(now / 1000);
	const seenTools = new Set();
	let started = false;
	const chunk = (delta, finish = null, used = null) => ({
		id,
		object: "chat.completion.chunk",
		created,
		model: modelName,
		choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }],
		...(used ? { usage: usage(used) } : {}),
	});
	const start = () => {
		if (started) {
			return undefined;
		}
		started = true;
		return chunk({ role: "assistant", content: "" });
	};
	yield start();
	try {
		for await (const event of piStream) {
			if (event.type === "text_delta") {
				yield chunk({ content: event.delta });
			} else if (event.type === "toolcall_end" && !seenTools.has(event.toolCall.id)) {
				seenTools.add(event.toolCall.id);
				yield chunk({
					tool_calls: [{
						index: seenTools.size - 1,
						id: event.toolCall.id,
						type: "function",
						function: {
							name: event.toolCall.name,
							arguments: JSON.stringify(event.toolCall.arguments ?? {}),
						},
					}],
				});
			} else if (event.type === "done") {
				for (const block of event.message.content) {
					if (block.type === "toolCall" && !seenTools.has(block.id)) {
						seenTools.add(block.id);
						yield chunk({
							tool_calls: [{
								index: seenTools.size - 1,
								id: block.id,
								type: "function",
								function: {
									name: block.name,
									arguments: JSON.stringify(block.arguments ?? {}),
								},
							}],
						});
					}
				}
				yield chunk(
					{},
					finishReason(event.reason),
					body.stream_options?.include_usage === true ? event.message.usage : null,
				);
				return;
			} else if (event.type === "error") {
				yield { error: { message: "The provider request failed.", type: "server_error", code: "provider_error" } };
				return;
			}
		}
	} catch {
		yield { error: { message: "The provider request failed.", type: "server_error", code: "provider_error" } };
	}
}

export function chatSseFrame(chunk) {
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

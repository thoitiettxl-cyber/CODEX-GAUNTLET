import { randomUUID } from "node:crypto";

import { RouterError, invalidRequest } from "./errors.js";

function string(value, path) {
	if (typeof value !== "string") {
		throw invalidRequest(`${path} must be a string.`);
	}
	return value;
}

function contentBlocks(content, path) {
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	if (!Array.isArray(content)) {
		throw invalidRequest(`${path} must be a string or content array.`);
	}
	return content.map((block, index) => {
		if (!block || typeof block !== "object" || Array.isArray(block)) {
			throw invalidRequest(`${path}[${index}] must be an object.`);
		}
		return block;
	});
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

function normalizeSystem(system) {
	if (system === undefined) {
		return undefined;
	}
	return contentBlocks(system, "system").map((block, index) => {
		if (block.type !== "text") {
			throw invalidRequest(`system[${index}] must be a text block.`);
		}
		return string(block.text, `system[${index}].text`);
	}).join("\n\n");
}

function normalizeTools(tools) {
	if (tools === undefined) {
		return undefined;
	}
	if (!Array.isArray(tools)) {
		throw invalidRequest("tools must be an array.");
	}
	return tools.map((tool, index) => {
		if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
			throw invalidRequest(`tools[${index}] must be an object.`);
		}
		const parameters = tool.input_schema;
		if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
			throw invalidRequest(`tools[${index}].input_schema must be an object.`);
		}
		return {
			name: string(tool.name, `tools[${index}].name`),
			description: typeof tool.description === "string" ? tool.description : "",
			parameters,
		};
	});
}

export function anthropicRequestToPi(body, model, now = Date.now()) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw invalidRequest("Request body must be a JSON object.");
	}
	if (body.stream !== undefined && typeof body.stream !== "boolean") {
		throw invalidRequest("stream must be a boolean.");
	}
	if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0) {
		throw invalidRequest("max_tokens must be a positive integer.");
	}
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		throw invalidRequest("messages must be a non-empty array.");
	}
	const messages = [];
	const toolNames = new Map();
	for (const [index, message] of body.messages.entries()) {
		if (
			!message
			|| typeof message !== "object"
			|| !["user", "assistant"].includes(message.role)
		) {
			throw invalidRequest(`messages[${index}] must have role user or assistant.`);
		}
		const blocks = contentBlocks(message.content, `messages[${index}].content`);
		if (message.role === "assistant") {
			const converted = blocks.map((block, blockIndex) => {
				const path = `messages[${index}].content[${blockIndex}]`;
				if (block.type === "text") {
					return { type: "text", text: string(block.text, `${path}.text`) };
				}
				if (block.type === "tool_use") {
					const id = string(block.id, `${path}.id`);
					const name = string(block.name, `${path}.name`);
					if (!block.input || typeof block.input !== "object" || Array.isArray(block.input)) {
						throw invalidRequest(`${path}.input must be an object.`);
					}
					toolNames.set(id, name);
					return { type: "toolCall", id, name, arguments: block.input };
				}
				throw invalidRequest(`${path} has an unsupported content type.`);
			});
			messages.push(assistantMessage(converted, model, now));
			continue;
		}
		let textParts = [];
		const flushText = () => {
			if (textParts.length > 0) {
				messages.push({ role: "user", content: textParts.join(""), timestamp: now });
				textParts = [];
			}
		};
		for (const [blockIndex, block] of blocks.entries()) {
			const path = `messages[${index}].content[${blockIndex}]`;
			if (block.type === "text") {
				textParts.push(string(block.text, `${path}.text`));
				continue;
			}
			if (block.type === "tool_result") {
				flushText();
				const toolName = toolNames.get(block.tool_use_id);
				if (!toolName) {
					throw invalidRequest(`${path} has no matching tool_use.`, "orphaned_tool_output");
				}
				const resultText = contentBlocks(block.content ?? "", `${path}.content`)
					.map((part, partIndex) => {
						if (part.type !== "text") {
							throw invalidRequest(`${path}.content[${partIndex}] must be text.`);
						}
						return string(part.text, `${path}.content[${partIndex}].text`);
					})
					.join("");
				messages.push({
					role: "toolResult",
					toolCallId: block.tool_use_id,
					toolName,
					content: [{ type: "text", text: resultText }],
					isError: block.is_error === true,
					timestamp: now,
				});
				continue;
			}
			throw invalidRequest(`${path} has an unsupported content type.`);
		}
		flushText();
	}
	return {
		context: {
			systemPrompt: normalizeSystem(body.system),
			messages,
			tools: normalizeTools(body.tools),
		},
		options: {
			maxTokens: body.max_tokens,
			signal: undefined,
			transport: "sse",
		},
	};
}

function stopReason(reason) {
	if (reason === "length") {
		return "max_tokens";
	}
	if (reason === "toolUse") {
		return "tool_use";
	}
	return "end_turn";
}

function usage(value) {
	return {
		input_tokens: value?.input ?? 0,
		output_tokens: value?.output ?? 0,
	};
}

function content(message) {
	return message.content.map((block) => block.type === "toolCall"
		? { type: "tool_use", id: block.id, name: block.name, input: block.arguments ?? {} }
		: { type: "text", text: block.text });
}

function providerFailure() {
	return new RouterError("The provider request failed.", {
		status: 502,
		code: "provider_error",
		type: "server_error",
		expose: false,
	});
}

export async function collectAnthropicMessage(piStream, {
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
		id: `msg_${randomUUID().replaceAll("-", "")}`,
		type: "message",
		role: "assistant",
		content: content(terminal.message),
		model: modelName,
		stop_reason: stopReason(terminal.reason),
		stop_sequence: null,
		usage: usage(terminal.message.usage),
	};
}

export async function* translateAnthropicStream(piStream, {
	modelName,
	now = Date.now(),
} = {}) {
	const id = `msg_${randomUUID().replaceAll("-", "")}`;
	const blocks = new Map();
	let outputIndex = 0;
	yield {
		type: "message_start",
		message: {
			id,
			type: "message",
			role: "assistant",
			content: [],
			model: modelName,
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 0, output_tokens: 0 },
		},
	};
	try {
		for await (const event of piStream) {
			if (event.type === "text_start") {
				const index = outputIndex++;
				blocks.set(`text:${event.contentIndex}`, index);
				yield { type: "content_block_start", index, content_block: { type: "text", text: "" } };
			} else if (event.type === "text_delta") {
				let index = blocks.get(`text:${event.contentIndex}`);
				if (index === undefined) {
					index = outputIndex++;
					blocks.set(`text:${event.contentIndex}`, index);
					yield { type: "content_block_start", index, content_block: { type: "text", text: "" } };
				}
				yield { type: "content_block_delta", index, delta: { type: "text_delta", text: event.delta } };
			} else if (event.type === "text_end") {
				const index = blocks.get(`text:${event.contentIndex}`);
				if (index !== undefined) {
					yield { type: "content_block_stop", index };
				}
			} else if (event.type === "toolcall_end" && !blocks.has(`tool:${event.toolCall.id}`)) {
				const index = outputIndex++;
				blocks.set(`tool:${event.toolCall.id}`, index);
				yield {
					type: "content_block_start",
					index,
					content_block: {
						type: "tool_use",
						id: event.toolCall.id,
						name: event.toolCall.name,
						input: {},
					},
				};
				yield {
					type: "content_block_delta",
					index,
					delta: {
						type: "input_json_delta",
						partial_json: JSON.stringify(event.toolCall.arguments ?? {}),
					},
				};
				yield { type: "content_block_stop", index };
			} else if (event.type === "done") {
				for (const block of event.message.content) {
					if (block.type === "toolCall" && !blocks.has(`tool:${block.id}`)) {
						const index = outputIndex++;
						blocks.set(`tool:${block.id}`, index);
						yield {
							type: "content_block_start",
							index,
							content_block: {
								type: "tool_use",
								id: block.id,
								name: block.name,
								input: {},
							},
						};
						yield {
							type: "content_block_delta",
							index,
							delta: {
								type: "input_json_delta",
								partial_json: JSON.stringify(block.arguments ?? {}),
							},
						};
						yield { type: "content_block_stop", index };
					}
				}
				yield {
					type: "message_delta",
					delta: { stop_reason: stopReason(event.reason), stop_sequence: null },
					usage: { output_tokens: event.message.usage?.output ?? 0 },
				};
				yield { type: "message_stop" };
				return;
			} else if (event.type === "error") {
				yield {
					type: "error",
					error: { type: "api_error", message: "The provider request failed." },
				};
				return;
			}
		}
	} catch {
		yield {
			type: "error",
			error: { type: "api_error", message: "The provider request failed." },
		};
	}
}

export function anthropicSseFrame(event) {
	return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

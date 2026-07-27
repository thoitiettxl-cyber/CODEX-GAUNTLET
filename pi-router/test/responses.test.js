import assert from "node:assert/strict";
import test from "node:test";

import {
	anthropicRequestToPi,
	collectAnthropicMessage,
	translateAnthropicStream,
} from "../src/anthropic-messages.js";
import {
	chatRequestToPi,
	collectChatCompletion,
	translateChatStream,
} from "../src/chat-completions.js";
import { collectResponse, requestToPi, translatePiStream } from "../src/responses.js";
import { MODEL, message, textStream } from "./helpers.js";

test("request conversion preserves instructions, messages, tools, and limits", () => {
	const converted = requestToPi(
		{
			model: "fake/model",
			instructions: "Be brief.",
			input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
			tools: [{
				type: "function",
				name: "weather",
				description: "Get weather",
				parameters: { type: "object", properties: { city: { type: "string" } } },
				strict: true,
			}],
			reasoning: { effort: "high" },
			max_output_tokens: 200,
		},
		MODEL,
		123,
	);
	assert.equal(converted.context.systemPrompt, "Be brief.");
	assert.deepEqual(converted.context.messages, [{ role: "user", content: "Hi", timestamp: 123 }]);
	assert.equal(converted.context.tools[0].name, "weather");
	assert.deepEqual(converted.context.tools[0].constrainedSampling, {
		type: "json_schema",
		strict: "require",
	});
	assert.equal(converted.options.reasoning, "high");
	assert.equal(converted.options.maxTokens, 200);
});

test("function call output becomes a Pi tool result with its tool name", () => {
	const converted = requestToPi(
		{
			model: "fake/model",
			input: [
				{ type: "function_call", call_id: "call_1", name: "weather", arguments: "{\"city\":\"Hue\"}" },
				{ type: "function_call_output", call_id: "call_1", output: "sunny" },
			],
		},
		MODEL,
		456,
	);
	assert.equal(converted.context.messages[0].content[0].type, "toolCall");
	assert.deepEqual(converted.context.messages[0].content[0].arguments, { city: "Hue" });
	assert.deepEqual(converted.context.messages[1], {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "weather",
		content: [{ type: "text", text: "sunny" }],
		isError: false,
		timestamp: 456,
	});
});

test("unsupported and stateful inputs fail instead of being dropped", () => {
	assert.throws(
		() => requestToPi({ input: [{ type: "image_generation_call" }] }, MODEL),
		/unsupported/,
	);
	assert.throws(
		() => requestToPi({ input: "hello", previous_response_id: "resp_old" }, MODEL),
		/previous_response_id/,
	);
	assert.throws(
		() => requestToPi({ input: "hello", store: true }, MODEL),
		/stored responses/,
	);
	assert.throws(
		() => requestToPi({ input: "hello", conversation: "conv_old" }, MODEL),
		/conversation state/,
	);
	assert.throws(
		() => requestToPi({
			input: [{ type: "function_call_output", call_id: "missing", output: "x" }],
		}, MODEL),
		/no matching function_call/,
	);
	assert.throws(
		() => requestToPi({
			input: [
				{ type: "function_call", call_id: "same", name: "one", arguments: "{}" },
				{ type: "function_call", call_id: "same", name: "two", arguments: "{}" },
			],
		}, MODEL),
		/must be unique/,
	);
});

test("text stream has monotonic typed lifecycle and a completed response", async () => {
	const events = [];
	for await (const event of translatePiStream(textStream("hello"), {
		body: { model: "fake/model", input: "Hi", stream: true },
		modelName: "fake/model",
		now: 1000,
	})) {
		events.push(event);
	}
	assert.deepEqual(
		events.map((event) => event.sequence_number),
		events.map((_, index) => index),
	);
	assert.equal(events[0].type, "response.created");
	assert.equal(events.at(-1).type, "response.completed");
	assert.ok(events.some((event) => event.type === "response.output_text.delta"));
	const response = await collectResponse((async function* () {
		yield* events;
	})());
	assert.equal(response.output[0].content[0].text, "hello");
	assert.equal(response.usage.total_tokens, 5);
});

test("tool calls become Responses function-call items", async () => {
	const toolCall = {
		type: "toolCall",
		id: "call_7",
		name: "weather",
		arguments: { city: "Hue" },
	};
	async function* stream() {
		yield { type: "toolcall_end", contentIndex: 0, toolCall, partial: message([toolCall], "toolUse") };
		yield { type: "done", reason: "toolUse", message: message([toolCall], "toolUse") };
	}
	const events = [];
	for await (const event of translatePiStream(stream(), {
		body: { model: "fake/model", input: "weather?" },
		modelName: "fake/model",
		now: 1000,
	})) {
		events.push(event);
	}
	assert.ok(events.some((event) => event.type === "response.function_call_arguments.delta"));
	assert.ok(events.some((event) => event.type === "response.function_call_arguments.done"));
	const response = events.at(-1).response;
	assert.deepEqual(
		{
			type: response.output[0].type,
			call_id: response.output[0].call_id,
			name: response.output[0].name,
			arguments: response.output[0].arguments,
		},
		{
			type: "function_call",
			call_id: "call_7",
			name: "weather",
			arguments: "{\"city\":\"Hue\"}",
		},
	);
});

test("terminal Pi message repairs missing end events without duplicating items", async () => {
	const toolCall = {
		type: "toolCall",
		id: "call_fallback",
		name: "weather",
		arguments: { city: "Hue" },
	};
	async function* stream() {
		yield {
			type: "text_delta",
			contentIndex: 0,
			delta: "partial",
			partial: message([{ type: "text", text: "partial" }]),
		};
		yield {
			type: "done",
			reason: "toolUse",
			message: message([
				{ type: "text", text: "complete" },
				toolCall,
			], "toolUse"),
		};
	}
	const events = [];
	for await (const event of translatePiStream(stream(), {
		body: { model: "fake/model", input: "weather?" },
		modelName: "fake/model",
		now: 1000,
	})) {
		events.push(event);
	}
	assert.equal(events.filter((event) => event.type === "response.output_item.done").length, 2);
	assert.equal(events.at(-1).response.output[0].content[0].text, "complete");
	assert.equal(events.at(-1).response.output[1].call_id, "call_fallback");
});

test("Chat Completions conversion preserves roles, tools, results, and token limits", () => {
	const converted = chatRequestToPi({
		model: "fake/model",
		messages: [
			{ role: "system", content: "Be brief." },
			{ role: "user", content: "Weather?" },
			{
				role: "assistant",
				content: null,
				tool_calls: [{
					id: "call_1",
					type: "function",
					function: { name: "weather", arguments: "{\"city\":\"Hue\"}" },
				}],
			},
			{ role: "tool", tool_call_id: "call_1", content: "sunny" },
		],
		tools: [{
			type: "function",
			function: {
				name: "weather",
				description: "Weather",
				parameters: { type: "object", properties: { city: { type: "string" } } },
			},
		}],
		max_completion_tokens: 32,
	}, MODEL, 100);
	assert.equal(converted.context.systemPrompt, "Be brief.");
	assert.equal(converted.context.messages[1].content[0].type, "toolCall");
	assert.equal(converted.context.messages[2].role, "toolResult");
	assert.equal(converted.context.messages[2].toolName, "weather");
	assert.equal(converted.context.tools[0].name, "weather");
	assert.equal(converted.options.maxTokens, 32);
});

test("Anthropic Messages conversion preserves text, tool use, and tool results", () => {
	const converted = anthropicRequestToPi({
		model: "fake/model",
		system: [{ type: "text", text: "Be brief." }],
		max_tokens: 64,
		messages: [
			{ role: "user", content: "Weather?" },
			{
				role: "assistant",
				content: [{
					type: "tool_use",
					id: "tool_1",
					name: "weather",
					input: { city: "Hue" },
				}],
			},
			{
				role: "user",
				content: [{
					type: "tool_result",
					tool_use_id: "tool_1",
					content: "sunny",
				}],
			},
		],
		tools: [{
			name: "weather",
			description: "Weather",
			input_schema: { type: "object", properties: { city: { type: "string" } } },
		}],
	}, MODEL, 100);
	assert.equal(converted.context.systemPrompt, "Be brief.");
	assert.equal(converted.context.messages[1].content[0].type, "toolCall");
	assert.equal(converted.context.messages[2].role, "toolResult");
	assert.equal(converted.context.tools[0].parameters.type, "object");
	assert.equal(converted.options.maxTokens, 64);
});

test("Chat and Anthropic non-stream collectors emit protocol-native envelopes", async () => {
	const chat = await collectChatCompletion(textStream("hello"), {
		modelName: "fake/model",
		now: () => 1000,
	});
	assert.equal(chat.object, "chat.completion");
	assert.equal(chat.choices[0].message.content, "hello");
	assert.equal(chat.choices[0].finish_reason, "stop");
	assert.equal(chat.usage.total_tokens, 5);

	const anthropic = await collectAnthropicMessage(textStream("hello"), {
		modelName: "fake/model",
		now: () => 1000,
	});
	assert.equal(anthropic.type, "message");
	assert.deepEqual(anthropic.content, [{ type: "text", text: "hello" }]);
	assert.equal(anthropic.stop_reason, "end_turn");
	assert.equal(anthropic.usage.output_tokens, 2);
});

test("Chat and Anthropic streaming translators emit native terminal events", async () => {
	const chat = [];
	for await (const chunk of translateChatStream(textStream("hello"), {
		body: { stream: true },
		modelName: "fake/model",
		now: () => 1000,
	})) {
		chat.push(chunk);
	}
	assert.equal(chat[0].choices[0].delta.role, "assistant");
	assert.ok(chat.some((chunk) => chunk.choices?.[0]?.delta?.content === "hello"));
	assert.equal(chat.at(-1).choices[0].finish_reason, "stop");

	const anthropic = [];
	for await (const event of translateAnthropicStream(textStream("hello"), {
		modelName: "fake/model",
		now: () => 1000,
	})) {
		anthropic.push(event);
	}
	assert.equal(anthropic[0].type, "message_start");
	assert.ok(anthropic.some((event) => event.type === "content_block_delta"));
	assert.equal(anthropic.at(-2).type, "message_delta");
	assert.equal(anthropic.at(-1).type, "message_stop");
});

test("Chat Completions rejects malformed messages, tools, and limits explicitly", () => {
	for (const body of [
		null,
		{ messages: [], stream: "yes" },
		{ messages: [{ role: "user", content: [{ type: "image_url", image_url: "x" }] }] },
		{
			messages: [{
				role: "assistant",
				tool_calls: [{
					id: "call",
					type: "function",
					function: { name: "tool", arguments: "not-json" },
				}],
			}],
		},
		{ messages: [{ role: "tool", tool_call_id: "missing", content: "x" }] },
		{ messages: [{ role: "unknown", content: "x" }] },
		{
			messages: [{ role: "user", content: "x" }],
			tools: [{ type: "custom" }],
		},
		{ messages: [{ role: "user", content: "x" }], max_tokens: 0 },
	]) {
		assert.throws(() => chatRequestToPi(body, MODEL), /must|supported|matching|valid/u);
	}
});

test("Anthropic Messages rejects malformed blocks, tools, and limits explicitly", () => {
	for (const body of [
		null,
		{ max_tokens: 1, messages: [], stream: "yes" },
		{ max_tokens: 0, messages: [{ role: "user", content: "x" }] },
		{ max_tokens: 1, messages: [{ role: "system", content: "x" }] },
		{
			max_tokens: 1,
			messages: [{ role: "assistant", content: [{ type: "image", source: {} }] }],
		},
		{
			max_tokens: 1,
			messages: [{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "missing", content: "x" }],
			}],
		},
		{
			max_tokens: 1,
			messages: [{ role: "user", content: "x" }],
			tools: [{ name: "bad" }],
		},
		{
			max_tokens: 1,
			system: [{ type: "image" }],
			messages: [{ role: "user", content: "x" }],
		},
	]) {
		assert.throws(
			() => anthropicRequestToPi(body, MODEL),
			/must|supported|matching/u,
		);
	}
});

test("Chat and Anthropic adapters preserve tool calls and provider failures", async () => {
	const toolCall = {
		type: "toolCall",
		id: "call_native",
		name: "weather",
		arguments: { city: "Hue" },
	};
	const toolStream = async function* () {
		yield {
			type: "toolcall_end",
			contentIndex: 0,
			toolCall,
			partial: message([toolCall], "toolUse"),
		};
		yield { type: "done", reason: "toolUse", message: message([toolCall], "toolUse") };
	};
	const chat = await collectChatCompletion(toolStream(), {
		modelName: "fake/model",
	});
	assert.equal(chat.choices[0].finish_reason, "tool_calls");
	assert.equal(chat.choices[0].message.tool_calls[0].function.name, "weather");
	const anthropic = await collectAnthropicMessage(toolStream(), {
		modelName: "fake/model",
	});
	assert.equal(anthropic.stop_reason, "tool_use");
	assert.equal(anthropic.content[0].type, "tool_use");

	const chatEvents = [];
	for await (const event of translateChatStream(toolStream(), {
		body: { stream: true, stream_options: { include_usage: true } },
		modelName: "fake/model",
	})) {
		chatEvents.push(event);
	}
	assert.equal(chatEvents[1].choices[0].delta.tool_calls[0].function.name, "weather");
	assert.equal(chatEvents.at(-1).usage.total_tokens, 5);
	const anthropicEvents = [];
	for await (const event of translateAnthropicStream(toolStream(), {
		modelName: "fake/model",
	})) {
		anthropicEvents.push(event);
	}
	assert.ok(anthropicEvents.some((event) =>
		event.type === "content_block_delta"
		&& event.delta.type === "input_json_delta"));

	const failed = async function* () {
		yield { type: "error", error: new Error("secret upstream failure") };
	};
	await assert.rejects(
		collectChatCompletion(failed(), { modelName: "fake/model" }),
		(error) => error.code === "provider_error",
	);
	await assert.rejects(
		collectAnthropicMessage(failed(), { modelName: "fake/model" }),
		(error) => error.code === "provider_error",
	);
	const chatFailure = [];
	for await (const event of translateChatStream(failed(), {
		body: { stream: true },
		modelName: "fake/model",
	})) {
		chatFailure.push(event);
	}
	assert.equal(chatFailure.at(-1).error.code, "provider_error");
	const anthropicFailure = [];
	for await (const event of translateAnthropicStream(failed(), {
		modelName: "fake/model",
	})) {
		anthropicFailure.push(event);
	}
	assert.equal(anthropicFailure.at(-1).type, "error");
	assert.doesNotMatch(JSON.stringify([chatFailure, anthropicFailure]), /secret upstream/u);
});

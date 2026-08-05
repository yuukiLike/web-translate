import assert from "node:assert/strict";
import test from "node:test";

import {
	createJsonResponse,
	createRequestRecorder,
	createTranslationRequest,
	loadProviderRuntime,
	toPlainValue,
	translationInstructions,
} from "../helpers/provider-runtime-harness.mjs";

const safeEventFields = new Set([
	"elapsedMs",
	"endpoint",
	"errorCode",
	"eventType",
	"httpStatus",
	"method",
	"requestId",
	"requestBody",
	"retryable",
	"status",
]);

function parseRequestBody(requests) {
	assert.equal(requests.length, 1);
	return JSON.parse(requests[0].init.body);
}

function assertSafeRequestEvents(events, apiKey, endpoint) {
	const plainEvents = toPlainValue(events);
	assert.deepEqual(
		plainEvents.map((event) => event.eventType),
		["request-start", "request-end"],
	);
	assert.equal(plainEvents[0].endpoint, endpoint);
	assert.equal(plainEvents[1].httpStatus, 200);
	assert.equal(plainEvents[1].retryable, false);
	assert.ok(
		plainEvents.every((event) => Object.keys(event).every((key) => safeEventFields.has(key))),
	);
	assert.equal(plainEvents.some((event) => Object.hasOwn(event, "headers")), false);
	assert.equal(plainEvents.some((event) => Object.hasOwn(event, "authorization")), false);
	assert.equal(JSON.stringify(plainEvents).includes(apiKey), false);
	return plainEvents;
}

// 非法 Provider 或跨 Provider 模型必须在任何网络请求发生前被拒绝。
test("运行时在 fetch 前拒绝非法 Provider 与模型", async () => {
	let fetchCount = 0;
	const { runtime } = await loadProviderRuntime(async () => {
		fetchCount += 1;
		throw new Error("不应发起请求");
	});

	await assert.rejects(
		runtime.generateTranslation(
			createTranslationRequest("openrouter", "openrouter/auto"),
		),
		/Unsupported provider: openrouter/u,
	);
	await assert.rejects(
		runtime.generateTranslation(
			createTranslationRequest("deepseek", "gpt-5.6-luna"),
		),
		/Model gpt-5\.6-luna is not allowlisted for provider deepseek/u,
	);
	assert.equal(fetchCount, 0);
});

// DeepSeek 必须使用官方接口、关闭思考，并只在请求开始事件暴露实际正文。
test("DeepSeek 请求关闭思考并捕获实际请求正文", async () => {
	const apiKey = "test-deepseek-secret";
	const events = [];
	const recorder = createRequestRecorder(() =>
		createJsonResponse({
			id: "response-test-id",
			created: 1,
			model: "deepseek-v4-flash",
			choices: [{ message: { role: "assistant", content: "译文" }, finish_reason: "stop" }],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 3,
				prompt_cache_hit_tokens: 2,
				total_tokens: 13,
			},
		}),
	);
	const { context, runtime } = await loadProviderRuntime(recorder.fetchImplementation);
	const result = await runtime.generateTranslation(
		createTranslationRequest("deepseek", "deepseek-v4-flash", {
			apiKey,
			maxOutputTokens: 100,
			captureRequestBody: true,
			onRequestEvent: (event) => events.push(event),
		}),
	);
	const body = parseRequestBody(recorder.requests);

	assert.equal(context.__zod_globalConfig.jitless, true);
	assert.equal(recorder.requests[0].input, "https://api.deepseek.com/chat/completions");
	assert.deepEqual(body.thinking, { type: "disabled" });
	assert.deepEqual(
		body.messages.map((message) => message.role),
		["system", "user"],
	);
	assert.equal(body.messages[0].content, translationInstructions);
	assert.deepEqual(toPlainValue(result), {
		text: "译文",
		finishReason: "stop",
		rawFinishReason: "stop",
		responseId: "response-test-id",
		responseModel: "deepseek-v4-flash",
		usage: {
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 2,
			cacheWriteTokens: 0,
			noCacheTokens: 8,
		},
		warningCount: 0,
	});
	const plainEvents = assertSafeRequestEvents(
		events,
		apiKey,
		"https://api.deepseek.com/chat/completions",
	);
	assert.equal(plainEvents[0].requestBody, recorder.requests[0].init.body);
	assert.deepEqual(JSON.parse(plainEvents[0].requestBody), body);
	assert.equal(Object.hasOwn(plainEvents[1], "requestBody"), false);
});

// DeepSeek 响应缺少 usage 时必须保留“未知”，不能伪装成零 token 造成错误用量统计。
test("DeepSeek 缺少 usage 时保留未知 token 用量", async () => {
	const recorder = createRequestRecorder(() =>
		createJsonResponse({
			id: "response-without-usage",
			created: 1,
			model: "deepseek-v4-flash",
			choices: [{ message: { role: "assistant", content: "译文" }, finish_reason: "stop" }],
		}),
	);
	const { runtime } = await loadProviderRuntime(recorder.fetchImplementation);
	const result = await runtime.generateTranslation(
		createTranslationRequest("deepseek", "deepseek-v4-flash"),
	);

	assert.equal(result.usage.inputTokens, undefined);
	assert.equal(result.usage.outputTokens, undefined);
	assert.equal(result.usage.cacheReadTokens, 0);
});

// OpenAI 必须调用官方 Responses API，并显式把推理强度降为 none。
test("OpenAI 使用官方 Responses API 并禁用推理", async () => {
	const events = [];
	const recorder = createRequestRecorder(() =>
		createJsonResponse({
			id: "resp_mock",
			created_at: 1,
			model: "gpt-5.6-luna",
			output: [
				{
					type: "message",
					role: "assistant",
					id: "msg_mock",
					content: [{ type: "output_text", text: "译文", annotations: [] }],
				},
			],
			usage: {
				input_tokens: 10,
				output_tokens: 3,
				output_tokens_details: { reasoning_tokens: 0 },
			},
		}),
	);
	const { runtime } = await loadProviderRuntime(recorder.fetchImplementation);
	const result = await runtime.generateTranslation(
		createTranslationRequest("openai", "gpt-5.6-luna", {
			onRequestEvent: (event) => events.push(event),
		}),
	);
	const body = parseRequestBody(recorder.requests);

	assert.equal(recorder.requests[0].input, "https://api.openai.com/v1/responses");
	assert.equal(body.model, "gpt-5.6-luna");
	assert.deepEqual(body.reasoning, { effort: "none" });
	assert.equal(result.text, "译文");
	assert.equal(result.responseId, "resp_mock");
	assert.equal(result.responseModel, "gpt-5.6-luna");
	const plainEvents = assertSafeRequestEvents(
		events,
		"test-openai-api-key",
		"https://api.openai.com/v1/responses",
	);
	assert.equal(Object.hasOwn(plainEvents[0], "requestBody"), false);
});

// 自定义 OpenAI-compatible 服务必须走 Chat Completions，兼容不实现 Responses API 的代理。
test("自定义服务显式使用 Chat Completions API", async () => {
	const recorder = createRequestRecorder(() =>
		createJsonResponse({
			id: "chatcmpl_custom",
			created: 1,
			model: "private-model",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "译文" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
		}),
	);
	const { runtime } = await loadProviderRuntime(recorder.fetchImplementation);
	const result = await runtime.generateTranslation(
		createTranslationRequest("custom", "private-model", {
			baseUrl: "https://custom.example/v1",
		}),
	);
	const body = parseRequestBody(recorder.requests);

	assert.equal(recorder.requests[0].input, "https://custom.example/v1/chat/completions");
	assert.equal(body.model, "private-model");
	assert.deepEqual(
		body.messages.map((message) => message.role),
		["system", "user"],
	);
	assert.equal(result.text, "译文");
	assert.equal(result.responseId, "chatcmpl_custom");
});

// Google 必须调用官方 Gemini 接口，并使用最低 thinkingLevel 且不返回思考内容。
test("Google 使用官方 Gemini 接口与最低思考参数", async () => {
	const recorder = createRequestRecorder(() =>
		createJsonResponse({
			candidates: [
				{ content: { parts: [{ text: "译文" }] }, finishReason: "STOP" },
			],
			usageMetadata: {
				promptTokenCount: 10,
				candidatesTokenCount: 3,
				totalTokenCount: 13,
			},
		}),
	);
	const { runtime } = await loadProviderRuntime(recorder.fetchImplementation);
	const result = await runtime.generateTranslation(
		createTranslationRequest("google", "gemini-3.5-flash-lite"),
	);
	const body = parseRequestBody(recorder.requests);

	assert.equal(
		recorder.requests[0].input,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
	);
	assert.deepEqual(body.generationConfig.thinkingConfig, {
		includeThoughts: false,
		thinkingLevel: "minimal",
	});
	assert.equal(result.text, "译文");
});

// Anthropic 必须调用官方 Messages API，并明确关闭 extended thinking。
test("Anthropic 使用官方 Messages API 并关闭思考", async () => {
	const recorder = createRequestRecorder(() =>
		createJsonResponse({
			type: "message",
			id: "msg_mock",
			model: "claude-sonnet-5",
			content: [{ type: "text", text: "译文" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 10, output_tokens: 3 },
		}),
	);
	const { runtime } = await loadProviderRuntime(recorder.fetchImplementation);
	const result = await runtime.generateTranslation(
		createTranslationRequest("anthropic", "claude-sonnet-5"),
	);
	const body = parseRequestBody(recorder.requests);

	assert.equal(recorder.requests[0].input, "https://api.anthropic.com/v1/messages");
	assert.deepEqual(body.thinking, { type: "disabled" });
	assert.equal(result.text, "译文");
	assert.equal(result.responseId, "msg_mock");
	assert.equal(result.responseModel, "claude-sonnet-5");
});

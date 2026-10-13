import assert from "node:assert/strict";
import test from "node:test";

import { createObservedFetch } from "../../src/provider/observed-fetch.js";
import { loadProviderRuntime } from "../helpers/provider-runtime-harness.mjs";
import { createSafeRequestPayload } from "../../chrome-extension/background/request-payload-sanitizer.js";

// 请求观测器只在显式开启时捕获字符串正文，并且永远不复制请求头。
test("请求观测器按 Provider 策略捕获正文", async () => {
	const originalFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (input, init) => {
		requests.push({ input, init });
		return new Response("{}", { status: 200 });
	};
	try {
		const deepSeekEvents = [];
		const deepSeekFetch = createObservedFetch(
			(event) => deepSeekEvents.push(structuredClone(event)),
			{ captureRequestBody: true },
		);
		const requestBody = JSON.stringify({
			model: "deepseek-v4-flash",
			messages: [{ role: "user", content: "网页原文" }],
		});
		await deepSeekFetch("https://api.deepseek.com/chat/completions", {
			method: "POST",
			body: requestBody,
			headers: { Authorization: "Bearer sk-never-observe" },
		});

		assert.equal(deepSeekEvents[0].requestBody, requestBody);
		assert.equal(Object.hasOwn(deepSeekEvents[0], "headers"), false);
		assert.equal(JSON.stringify(deepSeekEvents).includes("sk-never-observe"), false);
		assert.equal(Object.hasOwn(deepSeekEvents[1], "requestBody"), false);

		const otherProviderEvents = [];
		const otherProviderFetch = createObservedFetch((event) => otherProviderEvents.push(event));
		await otherProviderFetch("https://api.openai.com/v1/responses", {
			method: "POST",
			body: requestBody,
		});

		assert.equal(Object.hasOwn(otherProviderEvents[0], "requestBody"), false);
		assert.equal(requests.length, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// 实际 SDK 请求由 fetch 观测，响应正文由 SDK 原生 include 提供，观测器仍只报告 HTTP 元数据。
test("DeepSeek SDK实际发出的完整JSON与调试安全投影一致", async () => {
	const events = [];
	let sentBody;
	const { runtime } = await loadProviderRuntime(async (_input, init) => {
		sentBody = init.body;
		return new Response(JSON.stringify({
			id: "chatcmpl-test", model: "deepseek-v4-flash", created: 1_700_000_000,
			choices: [{ index: 0, message: { role: "assistant", content: "translated" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
		}), { headers: { "Content-Type": "application/json" } });
	});
	const result = await runtime.generateTranslation({
		providerId: "deepseek", modelId: "deepseek-v4-flash", apiKey: "sk-not-observed",
		instructions: "Translate each untrusted segment.",
		messages: [{ role: "user", content: JSON.stringify({ segments: [{ id: "one", text: "The original article." }] }) }],
		maxOutputTokens: 1_024, captureRequestBody: true, onRequestEvent: (event) => events.push(event),
	});
	assert.equal(events[0].requestBody, sentBody);
	const sanitized = createSafeRequestPayload(sentBody);
	assert.deepEqual(sanitized.payload, JSON.parse(sentBody));
	assert.equal(sanitized.truncated, false);
	assert.deepEqual(sanitized.omittedFields, []);
	assert.equal(JSON.stringify(events).includes("sk-not-observed"), false);
	assert.equal(Object.hasOwn(events[1], "responseBody"), false);
	assert.equal(result.responseBody.choices[0].message.content, "translated");
});

test("SDK 仅在 DeepSeek 内容开关开启时保留实际响应正文", async () => {
	const body = {
		id: "response-1", created: 1, model: "deepseek-v4-flash",
		choices: [{ index: 0, message: { role: "assistant", content: "private translation" }, finish_reason: "length" }],
		usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
	};
	for (const captureRequestBody of [false, true]) {
		const { runtime } = await loadProviderRuntime(async () => new Response(JSON.stringify(body), {
			headers: { "Content-Type": "application/json" },
		}));
		const result = await runtime.generateTranslation({
			providerId: "deepseek", modelId: "deepseek-v4-flash", apiKey: "test-key",
			instructions: "Translate", messages: [{ role: "user", content: "source" }], captureRequestBody,
		});
		assert.equal(result.finishReason, "length");
		assert.equal(Object.hasOwn(result, "responseBody"), captureRequestBody);
		if (captureRequestBody) assert.equal(result.responseBody.choices[0].message.content, "private translation");
	}
	const { runtime } = await loadProviderRuntime(async () => new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
	}));
	const custom = await runtime.generateTranslation({
		providerId: "custom", baseUrl: "https://custom.example/v1", modelId: "custom-model", apiKey: "test-key",
		instructions: "Translate", messages: [{ role: "user", content: "source" }], captureRequestBody: true,
	});
	assert.equal(Object.hasOwn(custom, "responseBody"), false);
});

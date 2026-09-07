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

// 验证调试内容来自实际 SDK 请求，同时凭据和响应正文始终不进入观测数据。
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
	await runtime.generateTranslation({
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
});

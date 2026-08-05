import assert from "node:assert/strict";
import test from "node:test";

import { createObservedFetch } from "../../src/provider/observed-fetch.js";

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

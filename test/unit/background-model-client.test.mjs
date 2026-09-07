import assert from "node:assert/strict";
import test from "node:test";

import { createModelClient } from "../../chrome-extension/background/providers/model-client.js";
import { abortableDelay } from "../../chrome-extension/background/request-errors.js";
import { backgroundCore } from "../helpers/background-harness.mjs";

function createClient(generateTranslation, onEvent = () => {}) {
	const events = [];
	const client = createModelClient({
		core: backgroundCore,
		providerRuntime: { generateTranslation },
		debug: {
			getSafeEndpoint: (endpoint) => endpoint,
			recordRequest(_context, event) {
				events.push(event);
				onEvent(event);
			},
		},
	});
	return { client, events };
}

function unavailableError(status = 503, retryAfterMs = 1) {
	return Object.assign(new Error("上游响应中的私密细节"), { status, retryAfterMs });
}

// 验证短暂故障遵循 Retry-After 重试，成功结果保留真实请求次数且前后尝试共享同一请求标识。
test("模型网络重试保留调用次数与请求身份", async () => {
	let requests = 0;
	const expected = { text: "result", usage: {} };
	const { client, events } = createClient(async () => {
		requests += 1;
		if (requests === 1) throw unavailableError();
		return expected;
	});

	const result = await client.generateWithRetry({ sourceCharacters: 12 }, new AbortController().signal, {});

	assert.deepEqual(result, { result: expected, apiCalls: 2 });
	const starts = events.filter((event) => event.eventType === "model.request.started");
	assert.deepEqual(starts.map((event) => event.attempt), [1, 2]);
	assert.equal(starts[0].requestId, starts[1].requestId);
});

// 验证不应重试的认证失败及超长限流都及时停止，并保留未知 token 用量和安全错误信息。
test("不可重试错误与超长限流不会重复发送原文", async () => {
	for (const failure of [unavailableError(401), unavailableError(429, 60_001)]) {
		let requests = 0;
		const { client } = createClient(async () => {
			requests += 1;
			throw failure;
		});

		await assert.rejects(
			client.generateWithRetry({ sourceCharacters: 12 }, new AbortController().signal, {}),
			(error) => {
				assert.equal(error.message.includes("私密细节"), false);
				assert.equal(error.translationUsage.apiCalls, 1);
				assert.equal(error.translationUsage.charactersSubmitted, 12);
				assert.equal(error.translationUsage.tokenUsageMissingCalls, 1);
				return true;
			},
		);
		assert.equal(requests, 1);
	}
});

// 验证持续网络故障最多发起三次请求，失败结果记录所有尝试而非只记录最后一次。
test("模型网络重试达到三次后停止", async () => {
	let requests = 0;
	const { client } = createClient(async () => {
		requests += 1;
		throw unavailableError();
	});

	await assert.rejects(
		client.generateWithRetry({ sourceCharacters: 12 }, new AbortController().signal, {}),
		(error) => {
			assert.equal(error.translationUsage.apiCalls, 3);
			assert.equal(error.translationUsage.charactersSubmitted, 36);
			assert.equal(error.translationUsage.tokenUsageMissingCalls, 3);
			return true;
		},
	);
	assert.equal(requests, 3);
});

// 验证退避等待期间取消会立即停止，失败用量只包含已经发送的第一次请求。
test("取消重试等待不会产生第二次模型请求", async () => {
	const controller = new AbortController();
	const waiting = Promise.withResolvers();
	let requests = 0;
	const { client } = createClient(async () => {
		requests += 1;
		throw unavailableError(503, 5_000);
	}, (event) => {
		if (event.eventType === "model.request.retry-scheduled") waiting.resolve();
	});
	const pending = client.generateWithRetry({ sourceCharacters: 12 }, controller.signal, {});
	await waiting.promise;
	controller.abort(new Error("翻译已取消"));

	await assert.rejects(pending, (error) => {
		assert.equal(error.message, "翻译已取消");
		assert.equal(error.translationUsage.apiCalls, 1);
		return true;
	});
	assert.equal(requests, 1);
});

// 验证已经取消的等待不会挂到下一轮定时器，保留原始取消原因。
test("退避等待开始前已取消时立即拒绝", async () => {
	const controller = new AbortController();
	const reason = new Error("翻译已取消");
	controller.abort(reason);

	await assert.rejects(abortableDelay(1, controller.signal), (error) => error === reason);
});

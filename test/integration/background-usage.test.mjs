import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import {
	backgroundCatalog,
	backgroundCore,
	createChromeHarness,
	createProviderRuntimeFake,
	createWebpageSender,
	sendAppMessage,
} from "../helpers/background-harness.mjs";

// Provider 未返回 usage 时，后台必须记录缺失次数且不能把未知 token 持久化成零。
test("后台保留缺失 token 用量的未知语义", async () => {
	const harness = createChromeHarness();
	const app = createBackgroundApp({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		providerRuntime: createProviderRuntimeFake({ omitUsage: true }),
	});
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-missing-usage" }, sender);
	const response = await sendAppMessage(
		app,
		{
			type: "TRANSLATE_BATCH",
			runId: "run-missing-usage",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "segment-1", text: "Hello world" }],
		},
		sender,
	);
	assert.equal(response.ok, true);

	const providerUsage =
		harness.local.data[backgroundCore.USAGE_KEY][backgroundCore.getMonthKey()].deepseek;
	assert.equal(providerUsage.apiCalls, 1);
	assert.equal(providerUsage.tokenUsageMissingCalls, 1);
	assert.equal(Object.hasOwn(providerUsage, "inputTokens"), false);
	assert.equal(Object.hasOwn(providerUsage, "outputTokens"), false);
});

// Provider 连续截断并最终失败时，后台仍须持久化此前已经发生的全部付费调用。
test("后台记录失败恢复路径已经产生的模型用量", async () => {
	const harness = createChromeHarness();
	const providerRuntime = {
		async generateTranslation() {
			return {
				text: "",
				finishReason: "length",
				usage: { inputTokens: 1, outputTokens: 10 },
			};
		},
	};
	const app = createBackgroundApp({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		providerRuntime,
	});
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-failed-recovery" }, sender);
	const response = await sendAppMessage(
		app,
		{
			type: "TRANSLATE_BATCH",
			runId: "run-failed-recovery",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [
				{ id: "first", text: "a".repeat(2_000) },
				{ id: "second", text: "b".repeat(2_000) },
			],
		},
		sender,
	);

	assert.equal(response.ok, false);
	assert.match(response.error, /已自动缩小批次但仍未完成/u);
	const providerUsage =
		harness.local.data[backgroundCore.USAGE_KEY][backgroundCore.getMonthKey()].deepseek;
	assert.equal(providerUsage.apiCalls, 3);
	assert.equal(providerUsage.charactersSubmitted, 7_000);
	assert.equal(providerUsage.inputTokens, 3);
	assert.equal(providerUsage.outputTokens, 30);
});

// 首个恢复子批完成后取消任务时，不得继续请求，但取消前已经产生的用量必须保留。
test("恢复途中取消会停止后续请求并保存已有用量", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	let app;
	let requestCount = 0;
	const providerRuntime = {
		async generateTranslation(request) {
			requestCount += 1;
			const payload = JSON.parse(request.messages[0].content);
			if (requestCount === 1) {
				return {
					text: "",
					finishReason: "length",
					usage: { inputTokens: 1, outputTokens: 10 },
				};
			}
			assert.equal(requestCount, 2, "取消后不应启动下一个恢复子批");
			await sendAppMessage(
				app,
				{ type: "CANCEL_RUN", runId: "run-cancelled-recovery" },
				sender,
			);
			return {
				text: JSON.stringify({
					translations: payload.segments.map((segment) => ({
						id: segment.id,
						text: `译文：${segment.text}`,
					})),
				}),
				finishReason: "stop",
				usage: { inputTokens: 2, outputTokens: 2 },
			};
		},
	};
	app = createBackgroundApp({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		providerRuntime,
	});
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-cancelled-recovery" }, sender);
	const response = await sendAppMessage(
		app,
		{
			type: "TRANSLATE_BATCH",
			runId: "run-cancelled-recovery",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [
				{ id: "first", text: "a".repeat(2_000) },
				{ id: "second", text: "b".repeat(2_000) },
			],
		},
		sender,
	);

	assert.equal(response.ok, false);
	assert.match(response.error, /翻译已取消/u);
	assert.equal(requestCount, 2);
	const providerUsage =
		harness.local.data[backgroundCore.USAGE_KEY][backgroundCore.getMonthKey()].deepseek;
	assert.equal(providerUsage.apiCalls, 2);
	assert.equal(providerUsage.charactersSubmitted, 6_000);
	assert.equal(providerUsage.inputTokens, 3);
	assert.equal(providerUsage.outputTokens, 12);
});

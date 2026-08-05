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

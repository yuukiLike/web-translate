import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import {
	backgroundCatalog,
	backgroundCore,
	createChromeHarness,
	createConfiguredSettings,
	createExtensionSender,
	createProviderRuntimeFake,
	createWebpageSender,
	sendAppMessage,
} from "../helpers/background-harness.mjs";

function createApp(settings) {
	const harness = createChromeHarness({ settings });
	const providerRuntime = createProviderRuntimeFake();
	const app = createBackgroundApp({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		providerRuntime,
	});
	return { app, harness, providerRuntime };
}

async function translateOnce(app, sender, runId, text) {
	await sendAppMessage(app, { type: "START_RUN", runId }, sender);
	await sendAppMessage(
		app,
		{
			type: "TRANSLATE_BATCH",
			runId,
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "secret", text }],
		},
		sender,
	);
}

async function getDebugEvents(app) {
	const response = await sendAppMessage(
		app,
		{ type: "GET_DEBUG_LOGS" },
		createExtensionSender(),
	);
	return response.events;
}

// 明示授权只适用于普通窗口；无痕请求必须在 Provider 前停止捕获并且不得落入 session。
test("独立授权只捕获普通窗口 DeepSeek 正文", async () => {
	const settings = createConfiguredSettings({
		debugLogging: true,
		debugRequestPayload: true,
	});
	const normal = createApp(settings);
	await normal.app.start();
	assert.deepEqual(
		await sendAppMessage(
			normal.app,
			{ type: "SET_DEBUG_REQUEST_PAYLOAD", enabled: true },
			createWebpageSender(),
		),
		{ ok: false, error: "网页脚本无权读取敏感设置" },
	);
	await translateOnce(
		normal.app,
		createWebpageSender(),
		"run-normal-private",
		"普通窗口机密正文",
	);

	assert.equal(normal.providerRuntime.requests[0].captureRequestBody, true);
	assert.match(JSON.stringify(await getDebugEvents(normal.app)), /普通窗口机密正文/u);

	const incognito = createApp(settings);
	await incognito.app.start();
	await translateOnce(
		incognito.app,
		createWebpageSender({ incognito: true }),
		"run-incognito-private",
		"无痕窗口机密正文",
	);

	assert.equal(incognito.providerRuntime.requests[0].captureRequestBody, false);
	assert.doesNotMatch(JSON.stringify(await getDebugEvents(incognito.app)), /无痕窗口机密正文/u);
	assert.doesNotMatch(JSON.stringify(incognito.harness.session.data), /无痕窗口机密正文/u);
});

// 旧版 debugLogging 不能隐式升级为正文授权，设置页连接测试则应使用用户的新授权。
test("旧调试设置不授权正文，连接测试则遵守新授权", async () => {
	const legacySettings = createConfiguredSettings({ debugLogging: true });
	delete legacySettings.debugRequestPayload;
	const legacy = createApp(legacySettings);
	await legacy.app.start();
	await translateOnce(
		legacy.app,
		createWebpageSender(),
		"run-legacy-private",
		"升级前用户私密正文",
	);

	assert.equal(legacy.providerRuntime.requests[0].captureRequestBody, false);
	assert.doesNotMatch(JSON.stringify(await getDebugEvents(legacy.app)), /升级前用户私密正文/u);

	const consented = createApp(
		createConfiguredSettings({ debugLogging: true, debugRequestPayload: true }),
	);
	await consented.app.start();
	await sendAppMessage(
		consented.app,
		{ type: "TEST_PROVIDER" },
		createExtensionSender(),
	);

	assert.equal(consented.providerRuntime.requests[0].captureRequestBody, true);
	assert.match(JSON.stringify(await getDebugEvents(consented.app)), /hello/u);
});

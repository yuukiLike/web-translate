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
import { createJsonResponse, loadProviderRuntime } from "../helpers/provider-runtime-harness.mjs";
import { createDebugRequests } from "../../src/options/debugRequests.js";

function createApp(settings) {
	const harness = createChromeHarness({ settings });
	const providerRuntime = createProviderRuntimeFake();
	const generate = providerRuntime.generateTranslation;
	providerRuntime.generateTranslation = async (request) => {
		const result = await generate(request);
		return { ...result, responseBody: {
			id: "response-private", model: request.modelId,
			choices: [{ message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
		} };
	};
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
	return await sendAppMessage(
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
	const response = (await getDebugEvents(normal.app)).find((event) => event.eventType === "model.request.completed");
	assert.match(response.responsePayload.choices[0].message.content, /普通窗口机密正文/u);

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
	assert.ok((await getDebugEvents(incognito.app)).every((event) => !event.responsePayload));
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

test("实际 SDK 的成功、无效译文和 HTTP 错误正文都关联到真实请求", async () => {
	for (const scenario of ["success", "invalid", "http-error"]) {
		const harness = createChromeHarness({ settings: createConfiguredSettings({
			debugLogging: true, debugRequestPayload: true,
		}) });
		const errorBody = { error: { code: "bad_request", type: "invalid_request_error", message: "Invalid parameter" } };
		const { runtime } = await loadProviderRuntime(async (_url, init) => {
			if (scenario === "http-error") return createJsonResponse(errorBody, 400);
			const request = JSON.parse(init.body);
			const input = JSON.parse(request.messages.find((message) => message.role === "user").content);
			const content = scenario === "invalid" ? "invalid json" : JSON.stringify({
				translations: input.segments.map(({ id }) => ({ id, text: "实际SDK译文" })),
			});
			return createJsonResponse({
				id: "chatcmpl-wire", model: request.model, created: 1,
				choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
				usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
			});
		});
		const app = createBackgroundApp({ chrome: harness.chrome, core: backgroundCore, providerCatalog: backgroundCatalog, providerRuntime: runtime });
		await app.start();
		const translated = await translateOnce(app, createWebpageSender(), `run-sdk-${scenario}`, "Hello.");
		assert.equal(translated.ok, scenario === "success", `${scenario}: ${translated.error || "翻译结果不符合预期"}`);
		const rows = createDebugRequests(await getDebugEvents(app));
		assert.equal(rows.length, scenario === "invalid" ? 3 : 1, `${scenario}: HTTP 请求数量应包含有限恢复`);
		assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
		for (const row of rows) {
			assert.equal(row.capture.status, "complete");
			assert.equal(row.responseCapture.status, "complete");
			assert.equal(row.status, scenario === "success" ? "ok" : "error");
			if (scenario === "http-error") {
				assert.deepEqual(row.responseCapture.payload, errorBody);
			} else {
				const returned = row.responseCapture.payload.choices[0].message.content;
				assert.equal(scenario === "invalid" ? returned : JSON.parse(returned).translations[0].text,
					scenario === "invalid" ? "invalid json" : "实际SDK译文");
			}
		}
		assert.doesNotMatch(JSON.stringify(rows), /sk-background-test/u);
	}
});

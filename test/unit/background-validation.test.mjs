import assert from "node:assert/strict";
import test from "node:test";

import { createSettingsStore } from "../../chrome-extension/background/settings-store.js";
import { createMessageValidators } from "../../chrome-extension/background/validation.js";
import {
	backgroundCatalog,
	backgroundCore,
	createChromeHarness,
	createExtensionSender,
	createWebpageSender,
} from "../helpers/background-harness.mjs";

const validators = createMessageValidators(backgroundCore);

// 验证合法批次会规范化正文，并只保留后台需要的可信字段。
test("翻译请求会规范化合法段落", () => {
	assert.deepEqual(
		validators.validateTranslationRequest({
			runId: "run-valid-1",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "segment-1", text: "  hello\n world  " }],
		}),
		{
			runId: "run-valid-1",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "segment-1", text: "hello\nworld" }],
		},
	);
});

// 验证任务 ID 与语言方向先失败，避免非法请求进入缓存和 Provider 流程。
test("翻译请求拒绝非法任务与语言方向", () => {
	assert.throws(() => validators.validateRunId("run id"), /无效任务 ID/u);
	assert.throws(
		() =>
			validators.validateTranslationRequest({
				runId: "run-1",
				sourceLanguage: "ja",
				targetLanguage: "zh",
				segments: [{ id: "one", text: "hello" }],
			}),
		/仅支持中英双语翻译/u,
	);
	assert.throws(
		() =>
			validators.validateTranslationRequest({
				runId: "run-1",
				sourceLanguage: "zh",
				targetLanguage: "zh",
				segments: [{ id: "one", text: "你好" }],
			}),
		/不能相同/u,
	);
});

// 验证重复 ID、空正文与超大消息都会在网络调用前被拒绝。
test("翻译请求限制段落唯一性与总字符数", () => {
	assert.throws(
		() =>
			validators.validateTranslationRequest({
				runId: "run-1",
				sourceLanguage: "en",
				targetLanguage: "zh",
				segments: [
					{ id: "same", text: "first" },
					{ id: "same", text: "second" },
				],
			}),
		/内容无效/u,
	);
	assert.throws(
		() =>
			validators.validateTranslationRequest({
				runId: "run-1",
				sourceLanguage: "en",
				targetLanguage: "zh",
				segments: [
					{ id: "one", text: "a".repeat(30_000) },
					{ id: "two", text: "b".repeat(21_000) },
				],
			}),
		/单批翻译字符数超出限制/u,
	);
});

// 验证只有扩展页面能读取或修改敏感设置，普通网页会在解析设置前被拒绝。
test("敏感设置只授权给扩展页面", async () => {
	const harness = createChromeHarness();
	const settingsStore = createSettingsStore({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		onDebugLoggingChanged() {},
	});

	assert.doesNotThrow(() => settingsStore.assertExtensionPage(createExtensionSender()));
	assert.throws(
		() => settingsStore.assertExtensionPage(createWebpageSender()),
		/无权读取敏感设置/u,
	);
	await settingsStore.initialize();
	assert.deepEqual(harness.local.accessLevels, [{ accessLevel: "TRUSTED_CONTEXTS" }]);
	assert.deepEqual(harness.session.accessLevels, [{ accessLevel: "TRUSTED_CONTEXTS" }]);
});

// 验证自定义 Provider 未获得目标域名权限时会给出明确错误。
test("自定义 Provider 必须先获得域名权限", async () => {
	const harness = createChromeHarness({ permissionGranted: false });
	const settingsStore = createSettingsStore({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		onDebugLoggingChanged() {},
	});
	const settings = backgroundCore.normalizeSettings({
		provider: "custom",
		custom: {
			apiKey: "custom-secret",
			baseUrl: "https://custom.example/v1",
			model: "custom-model",
		},
	});

	await assert.rejects(
		settingsStore.assertProviderPermission(settings),
		/尚未授权访问该自定义 API 域名/u,
	);
});

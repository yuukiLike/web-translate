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
	sendAppMessage,
} from "../helpers/background-harness.mjs";

function createApp(harness) {
	return createBackgroundApp({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		providerRuntime: createProviderRuntimeFake(),
	});
}

// 验证设置页晚到的全量旧快照只更新服务配置，不会覆盖 Popup 已保存的新语言方向。
test("全量设置保存保留队列中的最新语言方向", async () => {
	const harness = createChromeHarness();
	const app = createApp(harness);
	const sender = createExtensionSender("options/index.html");
	await app.start();

	await sendAppMessage(
		app,
		{ type: "SET_LANGUAGE_PAIR", sourceMode: "auto", targetLanguage: "en" },
		sender,
	);
	const staleSettings = createConfiguredSettings({
		sourceMode: "auto",
		targetMode: "zh",
		deepseek: { apiKey: "sk-updated-by-options" },
	});
	const response = await sendAppMessage(
		app,
		{ type: "SAVE_SETTINGS", settings: staleSettings },
		sender,
	);

	assert.equal(response.ok, true);
	assert.equal(response.settings.sourceMode, "auto");
	assert.equal(response.settings.targetMode, "en");
	assert.equal(response.settings.deepseek.apiKey, "sk-updated-by-options");
	assert.equal(harness.local.data[backgroundCore.SETTINGS_KEY].targetMode, "en");
});

import assert from "node:assert/strict";
import test from "node:test";

import { createCore } from "../../src/core/create-core.js";
import { createCatalogFixture } from "../helpers/catalog-fixture.mjs";

const core = createCore(await createCatalogFixture());

// 验证不可信设置会回落到安全默认值，而不是把非法 Provider 或并发数带入后台。
test("设置规范化会拒绝非法枚举并约束并发", () => {
	const settings = core.normalizeSettings({
		provider: "unknown",
		targetMode: "other",
		concurrency: 99,
		translateDynamicContent: "yes",
	});
	assert.equal(settings.provider, "deepseek");
	assert.equal(settings.targetMode, "auto");
	assert.equal(settings.concurrency, 4);
	assert.equal(settings.translateDynamicContent, true);
});

// 验证凭据会保留，但模型只能选择固定目录中的条目。
test("模型设置保留 API Key 并限制在 allowlist", () => {
	const longKey = `sk-${"x".repeat(1_000)}`;
	const settings = core.normalizeSettings({
		provider: "openai",
		openai: { apiKey: ` ${longKey} `, model: "not-allowed" },
	});
	assert.equal(settings.openai.apiKey, longKey);
	assert.equal(settings.openai.model, "gpt-5.6-luna");
});

// 验证自定义服务只允许 HTTPS 或本机 HTTP，并剥离末尾斜杠和内嵌凭据。
test("自定义 Base URL 遵守网络安全边界", () => {
	assert.equal(core.normalizeCustomBaseUrl("https://example.com/v1/"), "https://example.com/v1");
	assert.equal(core.normalizeCustomBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
	assert.equal(core.normalizeCustomBaseUrl("http://example.com/v1"), "");
	assert.equal(core.normalizeCustomBaseUrl("https://user:pass@example.com/v1"), "");
});

// 验证内容脚本只能收到运行所需的公开设置，不能读取任一 API Key。
test("公开任务设置不会泄露凭据", () => {
	const settings = core.normalizeSettings({
		provider: "deepseek",
		deepseek: { apiKey: "sk-secret", model: "deepseek-v4-flash" },
	});
	assert.deepEqual(core.publicSettings(settings), {
		provider: "deepseek",
		targetMode: "auto",
		translateDynamicContent: true,
		concurrency: 2,
	});
	assert.ok(!JSON.stringify(core.publicSettings(settings)).includes("secret"));
});

// 验证缺失配置能返回用户可理解的错误，而有效配置不会误报。
test("Provider 配置错误具有明确提示", () => {
	assert.match(core.getProviderConfigurationError(core.createDefaultSettings()), /API Key/u);
	const configured = core.normalizeSettings({
		provider: "deepseek",
		deepseek: { apiKey: "sk-ready", model: "deepseek-v4-flash" },
	});
	assert.equal(core.getProviderConfigurationError(configured), null);
});

// 验证 Provider 名称、并发与模型查询由同一个核心入口给出。
test("Provider 元数据接口保持一致", () => {
	assert.equal(core.getProviderLabel("azure"), "Azure Translator");
	assert.equal(core.getProviderMaximumConcurrency("azure"), 4);
	assert.equal(core.getProviderMaximumConcurrency("deepseek"), 2);
	assert.equal(core.getProviderModel(core.createDefaultSettings()), "deepseek-v4-flash");
	assert.equal(core.usesChatTranslation("custom"), true);
	assert.equal(core.usesChatTranslation("deepl"), false);
});

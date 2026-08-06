import assert from "node:assert/strict";
import test from "node:test";

import { createCore } from "../../src/core/create-core.js";
import { createCatalogFixture } from "../helpers/catalog-fixture.mjs";

const core = createCore(await createCatalogFixture());
const DEFAULT_CONTENT_FILTERS = {
	skipTechnicalIdentifiers: true,
	skipSocialMetadata: true,
	skipShortLinks: true,
};

function getLanguageSettings(settings) {
	return { sourceMode: settings.sourceMode, targetMode: settings.targetMode };
}

// 验证不可信设置会回落到安全默认值，而不是把非法 Provider 或并发数带入后台。
test("设置规范化会拒绝非法枚举并约束并发", () => {
	const settings = core.normalizeSettings({
		provider: "unknown",
		sourceMode: "other",
		targetMode: "other",
		concurrency: 99,
		translateDynamicContent: "yes",
	});
	assert.equal(settings.provider, "deepseek");
	assert.equal(settings.sourceMode, "auto");
	assert.equal(settings.targetMode, "zh");
	assert.equal(settings.concurrency, 4);
	assert.equal(settings.translateDynamicContent, true);
});

// 验证旧设置会获得完整过滤默认值，局部嵌套设置也不会因浅合并丢失其他字段。
test("内容过滤设置补齐默认值并保留显式关闭项", () => {
	const disabledFilters = Object.fromEntries(
		Object.keys(DEFAULT_CONTENT_FILTERS).map((key) => [key, false]),
	);
	assert.deepEqual(core.createDefaultSettings().contentFilters, DEFAULT_CONTENT_FILTERS);
	assert.deepEqual(core.normalizeSettings({}).contentFilters, DEFAULT_CONTENT_FILTERS);
	assert.deepEqual(
		core.normalizeSettings({ contentFilters: disabledFilters }).contentFilters,
		disabledFilters,
	);
	assert.deepEqual(
		core.normalizeSettings({ contentFilters: { skipShortLinks: false } }).contentFilters,
		{ ...DEFAULT_CONTENT_FILTERS, skipShortLinks: false },
	);
});

// 验证三个开关只接受布尔值，旧短按钮字段与其他未声明字段不能混入设置。
test("内容过滤设置拒绝非法值和未声明字段", () => {
	const contentFilters = core.normalizeSettings({
		contentFilters: {
			skipTechnicalIdentifiers: false,
			skipSocialMetadata: "false",
			skipShortLinks: 0,
			skipShortButtons: true,
			shortControlWordLimit: 99,
			skipNumericCounts: false,
		},
	}).contentFilters;

	assert.deepEqual(contentFilters, {
		...DEFAULT_CONTENT_FILTERS,
		skipTechnicalIdentifiers: false,
	});
	assert.equal(Object.hasOwn(contentFilters, "skipShortButtons"), false);
});

// 验证旧版复用 targetMode 的三个值能无损迁移，缺失设置仍采用自动识别并译为中文。
test("旧版语言方向迁移为独立的来源与目标字段", () => {
	for (const [legacyTargetMode, expected] of [
		["auto", { sourceMode: "auto", targetMode: "zh" }],
		["zh", { sourceMode: "en", targetMode: "zh" }],
		["en", { sourceMode: "zh", targetMode: "en" }],
	]) {
		const settings = core.normalizeSettings({ targetMode: legacyTargetMode });
		assert.deepEqual(getLanguageSettings(settings), expected);
	}
	assert.deepEqual(getLanguageSettings(core.createDefaultSettings()), {
		sourceMode: "auto",
		targetMode: "zh",
	});
});

// 验证自动识别可选择中英文目标，显式来源只接受互为相反语言的方向。
test("新语言字段只保留有意义的组合", () => {
	for (const expected of [
		{ sourceMode: "auto", targetMode: "zh" },
		{ sourceMode: "auto", targetMode: "en" },
		{ sourceMode: "en", targetMode: "zh" },
		{ sourceMode: "zh", targetMode: "en" },
	]) {
		const settings = core.normalizeSettings(expected);
		assert.deepEqual(getLanguageSettings(settings), expected);
	}
	assert.deepEqual(
		getLanguageSettings(core.normalizeSettings({ sourceMode: "zh", targetMode: "zh" })),
		{ sourceMode: "auto", targetMode: "zh" },
	);
	assert.deepEqual(
		getLanguageSettings(core.normalizeSettings({ sourceMode: "en", targetMode: "en" })),
		{ sourceMode: "auto", targetMode: "en" },
	);
});

// 旧版只有 debugLogging；升级后不得把它解释为已同意记录网页正文。
test("请求正文调试必须独立明示同意", () => {
	const legacy = core.normalizeSettings({ debugLogging: true });
	assert.equal(legacy.debugLogging, true);
	assert.equal(legacy.debugRequestPayload, false);

	const consented = core.normalizeSettings({
		debugLogging: true,
		debugRequestPayload: true,
	});
	assert.equal(consented.debugRequestPayload, true);
	assert.equal(
		core.normalizeSettings({ ...consented, debugLogging: false }).debugRequestPayload,
		false,
	);
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
		sourceMode: "auto",
		targetMode: "zh",
		translateDynamicContent: true,
		concurrency: 2,
		contentFilters: {
			...DEFAULT_CONTENT_FILTERS,
			skipShortButtons: false,
		},
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

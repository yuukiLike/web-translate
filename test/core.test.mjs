import assert from "node:assert/strict";
import test from "node:test";

import "../lib/provider-catalog.generated.js";
import "../lib/core.js";

const core = globalThis.BilingualTranslatorCore;

test("normalizes settings without leaking invalid values", () => {
	const settings = core.normalizeSettings({
		provider: "unknown",
		targetMode: "de",
		concurrency: 99,
		deepseek: { model: " custom-model " },
	});

	assert.equal(settings.provider, "deepseek");
	assert.equal(settings.targetMode, "auto");
	assert.equal(settings.concurrency, 4);
	assert.equal(settings.deepseek.model, "deepseek-v4-flash");
});

test("preserves credentials while constraining every model to the local allowlist", () => {
	const settings = core.normalizeSettings({
		provider: "openai",
		targetMode: "zh",
		translateDynamicContent: false,
		concurrency: 3,
		azure: { apiKey: "azure-key", region: "eastasia" },
		deepl: { apiKey: "deepl-key" },
		deepseek: { apiKey: "deepseek-key", model: "deepseek-chat" },
		openai: { apiKey: "openai-key", model: "gpt-5.6-luna" },
		google: { apiKey: "google-key", model: "unknown-google-model" },
		anthropic: { apiKey: "anthropic-key", model: "claude-sonnet-5" },
	});

	assert.equal(settings.provider, "openai");
	assert.equal(settings.debugLogging, false);
	assert.deepEqual(settings.azure, { apiKey: "azure-key", region: "eastasia" });
	assert.deepEqual(settings.deepl, { apiKey: "deepl-key" });
	assert.deepEqual(settings.deepseek, { apiKey: "deepseek-key", model: "deepseek-v4-flash" });
	assert.deepEqual(settings.openai, { apiKey: "openai-key", model: "gpt-5.6-luna" });
	assert.deepEqual(settings.google, { apiKey: "google-key", model: "gemini-3.5-flash-lite" });
	assert.deepEqual(settings.anthropic, { apiKey: "anthropic-key", model: "claude-sonnet-5" });
});

test("keeps long API keys intact and exposes only public run settings", () => {
	const apiKey = `key-${"x".repeat(1_000)}`;
	const settings = core.normalizeSettings({
		provider: "google",
		debugLogging: true,
		google: { apiKey, model: "gemini-3.5-flash-lite" },
	});

	assert.equal(settings.provider, "google");
	assert.equal(settings.debugLogging, true);
	assert.equal(settings.google.apiKey, apiKey);
	assert.deepEqual(core.publicSettings(settings), {
		provider: "google",
		targetMode: "auto",
		translateDynamicContent: true,
		concurrency: 2,
	});
});

test("exposes the fixed local provider catalog and recommendation order", () => {
	assert.equal(core.MODEL_CATALOG.source.commit, "141191529fcad56200de45e7267a21dffcc4c33e");
	assert.equal(core.MODEL_CATALOG.defaultProviderId, "deepseek");
	assert.deepEqual([...core.MODEL_PROVIDER_IDS], ["deepseek", "openai", "google", "anthropic"]);
	assert.deepEqual([...core.RECOMMENDED_MODEL_PROVIDERS], ["deepseek", "openai", "google"]);
	assert.equal(core.MODEL_CATALOG.providers.openai.defaultModelId, "gpt-5.6-luna");
});

test("centralizes provider labels, credentials, validation, limits, and concurrency", () => {
	const openai = core.normalizeSettings({
		provider: "openai",
		openai: { apiKey: "openai-key", model: "gpt-5.6-luna" },
	});

	assert.equal(core.getProviderLabel("azure"), "Azure Translator");
	assert.equal(core.getProviderLabel("openai"), "OpenAI");
	assert.equal(core.getProviderApiKey(openai), "openai-key");
	assert.equal(core.getProviderConfigurationError(openai), null);
	assert.match(core.getProviderConfigurationError({ provider: "deepl" }), /DeepL API Key/u);
	assert.equal(core.getProviderMaximumConcurrency("azure"), 4);
	assert.equal(core.getProviderMaximumConcurrency("deepl"), 4);
	assert.equal(core.getProviderMaximumConcurrency("deepseek"), 2);
	assert.equal(core.getProviderMaximumConcurrency("openai"), 2);
	assert.deepEqual(core.getProviderLimits("openai"), core.getProviderLimits("deepseek"));
	assert.equal(core.getProviderModel(openai), "gpt-5.6-luna");
});

test("detects the Chinese-English direction", () => {
	assert.deepEqual(core.getLanguagePair("zh-CN", "A mixed page", "auto"), {
		sourceLanguage: "zh",
		targetLanguage: "en",
	});
	assert.deepEqual(core.getLanguagePair("", "This is an English article.", "auto"), {
		sourceLanguage: "en",
		targetLanguage: "zh",
	});
	assert.deepEqual(core.getLanguagePair("en", "English", "en"), {
		sourceLanguage: "zh",
		targetLanguage: "en",
	});
});

test("filters text already written in the target language", () => {
	assert.equal(core.shouldTranslateText("A useful English paragraph.", "zh"), true);
	assert.equal(core.shouldTranslateText("这是已经存在的中文。", "zh"), false);
	assert.equal(core.shouldTranslateText("这是需要翻译的中文。", "en"), true);
	assert.equal(core.shouldTranslateText("Already English.", "en"), false);
	assert.equal(core.shouldTranslateText("https://example.com", "zh"), false);
});

test("splits long text and keeps all content", () => {
	const text = `${"First sentence. ".repeat(20)}${"Second sentence. ".repeat(20)}`.trim();
	const parts = core.splitText(text, 120);

	assert.ok(parts.length > 1);
	assert.ok(parts.every((part) => part.length <= 121));
	assert.equal(parts.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

test("preserves paragraph breaks in source text", () => {
	const text = "First line.\n\nSecond line.";

	assert.equal(core.normalizeSourceText(text), text);
	assert.equal(core.normalizeText(text), "First line. Second line.");
	assert.deepEqual(core.splitText(text, 3_500), [text]);
});

test("batches segments without changing their order", () => {
	const segments = [
		{ id: "a", text: "1234" },
		{ id: "b", text: "5678" },
		{ id: "c", text: "90" },
	];
	const batches = core.batchSegments(segments, 8, 2);

	assert.deepEqual(
		batches.map((batch) => batch.map((segment) => segment.id)),
		[["a", "b"], ["c"]],
	);
});

test("parses fenced model JSON and keeps the DeepSeek parser alias", () => {
	const content =
		'```json\n{"translations":[{"id":"b","text":"世界"},{"id":"a","text":"你好"}]}\n```';
	assert.deepEqual(core.parseModelTranslations(content, ["a", "b"]), ["你好", "世界"]);
	assert.deepEqual(core.parseDeepSeekTranslations(content, ["a", "b"]), ["你好", "世界"]);
	assert.throws(
		() => core.parseModelTranslations('{"translations":[{"id":"a","text":"缺少一个"}]}', ["a", "b"]),
		/数量/,
	);
	assert.throws(
		() => core.parseModelTranslations('{"translations":[{"id":"wrong","text":"错误"}]}', ["a"]),
		/ID/,
	);
});

test("cache keys vary by provider, direction, and text", () => {
	const azure = { ...core.createDefaultSettings(), provider: "azure" };
	const deepseek = { ...azure, provider: "deepseek" };

	assert.notEqual(core.cacheKey(azure, "en", "zh", "hello"), core.cacheKey(deepseek, "en", "zh", "hello"));
	assert.notEqual(core.cacheKey(azure, "en", "zh", "hello"), core.cacheKey(azure, "zh", "en", "hello"));
	assert.notEqual(core.cacheKey(azure, "en", "zh", "hello"), core.cacheKey(azure, "en", "zh", "world"));
	assert.notEqual(
		core.cacheKey(azure, "en", "zh", "hello", "https://one.example"),
		core.cacheKey(azure, "en", "zh", "hello", "https://two.example"),
	);
});

test("model cache signatures isolate explicit providers and protocol versions", () => {
	const deepseek = { provider: "deepseek", deepseek: { model: "deepseek-v4-flash" } };
	const openai = { provider: "openai", openai: { model: "gpt-5.6-luna" } };

	assert.match(core.getProviderSignature(deepseek), /deepseek-v4-flash/u);
	assert.match(core.getProviderSignature(deepseek), /ai-sdk-json-v2/u);
	assert.notEqual(
		core.cacheKey(deepseek, "en", "zh", "hello"),
		core.cacheKey(openai, "en", "zh", "hello"),
	);
});

test("routes legacy DeepL Free keys without a manual account selector", () => {
	assert.equal(core.getDeepLApiHost("example:fx"), "api-free.deepl.com");
	assert.equal(core.getDeepLApiHost("developer-or-pro-key"), "api.deepl.com");
});

test("bounds translated output relative to its source", () => {
	assert.equal(core.getMaximumTranslationLength(10), 2_000);
	assert.equal(core.getMaximumTranslationLength(3_000), 12_000);
	assert.equal(core.getMaximumTranslationLength(30_000), 20_000);
});

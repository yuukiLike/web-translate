import assert from "node:assert/strict";
import test from "node:test";

import "../lib/core.js";

const core = globalThis.BilingualTranslatorCore;

test("normalizes settings without leaking invalid values", () => {
	const settings = core.normalizeSettings({
		provider: "unknown",
		targetMode: "de",
		concurrency: 99,
		deepseek: { model: " custom-model " },
	});

	assert.equal(settings.provider, "azure");
	assert.equal(settings.targetMode, "auto");
	assert.equal(settings.concurrency, 4);
	assert.equal(settings.deepseek.model, "custom-model");
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

test("parses fenced DeepSeek JSON and validates cardinality", () => {
	const content =
		'```json\n{"translations":[{"id":"b","text":"世界"},{"id":"a","text":"你好"}]}\n```';
	assert.deepEqual(core.parseDeepSeekTranslations(content, ["a", "b"]), ["你好", "世界"]);
	assert.throws(
		() => core.parseDeepSeekTranslations('{"translations":[{"id":"a","text":"缺少一个"}]}', ["a", "b"]),
		/数量/,
	);
});

test("cache keys vary by provider, direction, and text", () => {
	const azure = core.createDefaultSettings();
	const deepseek = { ...azure, provider: "deepseek" };

	assert.notEqual(core.cacheKey(azure, "en", "zh", "hello"), core.cacheKey(deepseek, "en", "zh", "hello"));
	assert.notEqual(core.cacheKey(azure, "en", "zh", "hello"), core.cacheKey(azure, "zh", "en", "hello"));
	assert.notEqual(core.cacheKey(azure, "en", "zh", "hello"), core.cacheKey(azure, "en", "zh", "world"));
	assert.notEqual(
		core.cacheKey(azure, "en", "zh", "hello", "https://one.example"),
		core.cacheKey(azure, "en", "zh", "hello", "https://two.example"),
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

import assert from "node:assert/strict";
import test from "node:test";

import {
	MAXIMUM_INPUT_CHARACTERS,
	getLanguageDirection,
	getMaximumTranslationLength,
	normalizeInput,
	normalizePreferences,
	parseModelTranslation,
	validateTranslationPreferences,
} from "../src/lib/core.ts";

test("normalizes input while preserving paragraph boundaries", () => {
	assert.equal(
		normalizeInput("  First\u00a0line.\r\n\r\n\r\n Second line.  "),
		"First line.\n\nSecond line.",
	);
	assert.throws(() => normalizeInput("   "), /请输入/u);
	assert.throws(() => normalizeInput("---"), /没有可翻译/u);
	assert.throws(() => normalizeInput("a".repeat(MAXIMUM_INPUT_CHARACTERS + 1)), /最多翻译/u);
});

test("automatically chooses the Chinese-English direction", () => {
	assert.deepEqual(getLanguageDirection("This is an English article.", "auto"), {
		sourceLanguage: "en",
		targetLanguage: "zh",
	});
	assert.deepEqual(getLanguageDirection("这是需要翻译的中文。", "auto"), {
		sourceLanguage: "zh",
		targetLanguage: "en",
	});
	assert.deepEqual(getLanguageDirection("English", "en"), {
		sourceLanguage: "zh",
		targetLanguage: "en",
	});
});

test("validates the selected provider, API key, region, and fixed model", () => {
	const preferences = normalizePreferences({
		provider: "deepseek",
		targetLanguage: "auto",
		deepseekApiKey: " sk-example ",
		cacheEnabled: false,
		debugMode: true,
	});

	assert.deepEqual(preferences, {
		provider: "deepseek",
		targetLanguage: "auto",
		apiKey: "sk-example",
		azureRegion: "",
		cacheEnabled: false,
		debugMode: true,
		modelId: "deepseek-v4-flash",
	});
	assert.throws(
		() => normalizePreferences({ provider: "unknown", deepseekApiKey: "secret" }),
		/受支持/u,
	);
	assert.throws(() => normalizePreferences({ provider: "openai" }), /OpenAI API Key/u);
	assert.throws(
		() =>
			normalizePreferences({
				provider: "azure",
				azureApiKey: "key",
				azureRegion: "bad region",
			}),
		/Azure 资源区域/u,
	);
	assert.throws(
		() => validateTranslationPreferences({ ...preferences, modelId: "unlisted-model" }),
		/allowlist/u,
	);
});

test("parses only the expected model JSON result", () => {
	assert.equal(
		parseModelTranslation(
			'```json\n{"translations":[{"id":"translation","text":"你好"}]}\n```',
			"hello",
		),
		"你好",
	);
	assert.throws(
		() => parseModelTranslation('{"translations":[{"id":"wrong","text":"你好"}]}', "hello"),
		/ID/u,
	);
	assert.throws(
		() => parseModelTranslation('{"translations":[{"id":"translation","text":""}]}', "hello"),
		/长度/u,
	);
});

test("allows bounded expansion for long Chinese-English translations", () => {
	assert.equal(getMaximumTranslationLength(10), 2_000);
	assert.equal(getMaximumTranslationLength(3_000), 24_000);
	assert.equal(getMaximumTranslationLength(MAXIMUM_INPUT_CHARACTERS), MAXIMUM_INPUT_CHARACTERS * 8);
});

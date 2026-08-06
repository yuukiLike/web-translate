import assert from "node:assert/strict";
import test from "node:test";

import { createCore } from "../../src/core/create-core.js";
import { createCatalogFixture } from "../helpers/catalog-fixture.mjs";

const core = createCore(await createCatalogFixture());

// 验证自动来源依据 lang 与文本判断，同时保持用户选择的中英文目标。
test("自动来源识别支持中文与英文目标", () => {
	assert.deepEqual(core.getLanguagePair("", "Hello world", "auto", "zh"), {
		sourceLanguage: "en",
		targetLanguage: "zh",
	});
	assert.deepEqual(core.getLanguagePair("zh-CN", "Hello", "auto", "zh"), {
		sourceLanguage: "zh",
		targetLanguage: "zh",
	});
	assert.deepEqual(core.getLanguagePair("", "中文内容", "auto", "en"), {
		sourceLanguage: "zh",
		targetLanguage: "en",
	});
	assert.deepEqual(core.getLanguagePair("", "English content", "auto", "en"), {
		sourceLanguage: "en",
		targetLanguage: "en",
	});
});

// 验证显式来源始终使用固定的中英互译方向，不接受同语种目标污染任务。
test("显式来源固定为相反目标语言", () => {
	assert.deepEqual(core.getLanguagePair("zh-CN", "中文内容", "en", "en"), {
		sourceLanguage: "en",
		targetLanguage: "zh",
	});
	assert.deepEqual(core.getLanguagePair("en", "English content", "zh", "zh"), {
		sourceLanguage: "zh",
		targetLanguage: "en",
	});
});

// 验证核心文本门始终过滤 URL、数字展示和目标语言内容，不受候选策略配置影响。
test("核心文本门始终过滤无需翻译的基础文本", () => {
	assert.equal(core.shouldTranslateText("Hello world", "zh"), true);
	assert.equal(core.shouldTranslateText("已经是中文", "zh"), false);
	assert.equal(core.shouldTranslateText("已经是中文", "en"), true);
	assert.equal(core.shouldTranslateText("https://example.com", "zh"), false);
	assert.equal(core.shouldTranslateText("a", "zh"), false);
	for (const numericDisplay of [
		"11",
		"1.6K",
		"99+",
		"12,345",
		"3.5%",
		"$99",
		"2026-08-06",
		"14:30",
		"1K / 2K",
		"1920×1080",
	]) {
		assert.equal(core.shouldTranslateText(numericDisplay, "zh"), false, numericDisplay);
	}
	assert.equal(core.shouldTranslateText("Version 2", "zh"), true);
	assert.equal(core.shouldTranslateText("11 issues found", "zh"), true);
	assert.equal(core.shouldTranslateText("1.8m", "zh"), true);
});

// 验证技术标识和社交元数据能通过语言门，以便 Planner 按用户开关处理。
test("可配置内容候选能够到达 Planner", () => {
	for (const configurableCandidate of [
		"hello@example.com",
		"yuukiLike/cc-md-vault",
		"README.md",
		"v1.2.3",
		"a1b2c3d",
		"@xudong8834",
		"@alice_dev",
		"@foo@mastodon.social",
		"4h",
		"4 hours",
		"4 hours ago",
		"3d",
		"@xudong8834 4h",
		"@xudong8834 15m",
		"@xudong8834 · 4h",
	]) {
		assert.equal(
			core.shouldTranslateText(configurableCandidate, "zh"),
			true,
			configurableCandidate,
		);
	}
	assert.equal(core.shouldTranslateText("2小时前", "en"), true);

	for (const prose of [
		"4h battery life",
		"Battery lasts 4 hours",
		"Thanks @xudong8834 for the fix",
		"3D printing guide",
		"3D",
		"1.8m",
		"12m",
		"15m",
		"Yesterday",
	]) {
		assert.equal(core.shouldTranslateText(prose, "zh"), true, prose);
	}
	assert.equal(core.shouldTranslateText("昨天我们发布了版本", "en"), true);
	assert.equal(core.shouldTranslateText("刚刚修复了问题", "en"), true);
});

// 验证清洗文本时保留段落语义，仅折叠段落内部多余空白。
test("原文规范化保留段落边界", () => {
	assert.equal(core.normalizeSourceText(" First   line\n\n\n Second line "), "First line\n\nSecond line");
});

// 验证长文本切分后可无损拼回，且每段不超过请求上限。
test("长文本切分不会丢失内容", () => {
	const source = `${"First sentence. ".repeat(30)}\n${"第二段内容。".repeat(30)}`;
	const parts = core.splitText(source, 120);
	assert.ok(parts.length > 1);
	assert.ok(parts.every((part) => part.length <= 120));
	assert.equal(parts.join("").replaceAll(" ", ""), core.normalizeSourceText(source).replaceAll(" ", ""));
});

// 验证批处理只按字符数和条目数分组，不改变输入顺序。
test("批处理保持段落顺序", () => {
	const segments = [
		{ id: "a", text: "1234" },
		{ id: "b", text: "5678" },
		{ id: "c", text: "90" },
	];
	assert.deepEqual(core.batchSegments(segments, 6, 2).map((batch) => batch.map(({ id }) => id)), [
		["a"],
		["b", "c"],
	]);
});

// 验证模型 JSON 解析支持代码围栏，并严格检查段落 ID 和数量。
test("模型译文解析拒绝缺失或未知 ID", () => {
	assert.deepEqual(
		core.parseModelTranslations('```json\n{"translations":[{"id":"a","text":"译文"}]}\n```', ["a"]),
		["译文"],
	);
	assert.throws(
		() => core.parseModelTranslations('{"translations":[{"id":"b","text":"译文"}]}', ["a"]),
		/ID/u,
	);
});

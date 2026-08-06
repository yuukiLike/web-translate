import assert from "node:assert/strict";
import test from "node:test";

import { shouldSkipCandidate } from "../../src/content/translation/content-filter.js";

const ENABLED_FILTERS = Object.freeze({
	skipTechnicalIdentifiers: true,
	skipSocialMetadata: true,
	skipShortLinks: true,
});

function candidate(text, { metadataOnly = false, interactiveKind = null } = {}) {
	return { text, traits: { metadataOnly, interactiveKind } };
}

function filters(overrides = {}) {
	return { ...ENABLED_FILTERS, ...overrides };
}

// 验证独立的常用技术词始终跳过，而包含该词的完整句子仍保留翻译价值。
test("常用技术词只按完整候选过滤", () => {
	for (const term of [
		"v1",
		"V2",
		"bug",
		"API",
		"GitHub",
		"open",
		"closed",
		"Linux",
		"Windows",
		"main branch",
		"code",
		"add file",
		"star",
		"fork",
		"watch",
	]) {
		assert.equal(shouldSkipCandidate(candidate(term), {}), true, term);
		assert.equal(
			shouldSkipCandidate(candidate(term, { interactiveKind: "button" }), {}),
			true,
			`${term} button`,
		);
	}
	assert.equal(shouldSkipCandidate(candidate("Fix this bug before release"), {}), false);
	assert.equal(shouldSkipCandidate(candidate("Open the settings"), {}), false);
});

// 验证技术标识默认过滤，关闭对应配置后不会被其他正文策略误拦截。
test("技术标识过滤可以独立关闭", () => {
	for (const text of [
		"yuukiLike/cc-md-vault",
		"README.md",
		"v1.2.3",
		"a1b2c3d",
		"hello@example.com",
	]) {
		assert.equal(shouldSkipCandidate(candidate(text), ENABLED_FILTERS), true, text);
		assert.equal(
			shouldSkipCandidate(candidate(text), filters({ skipTechnicalIdentifiers: false })),
			false,
			text,
		);
	}
	assert.equal(shouldSkipCandidate(candidate("yuukiLike"), ENABLED_FILTERS), false);
	assert.equal(shouldSkipCandidate(candidate("cc-md-vault"), ENABLED_FILTERS), false);
	assert.equal(
		shouldSkipCandidate(candidate("Read README.md before continuing"), ENABLED_FILTERS),
		false,
	);
});

// 验证账号、相对时间及纯元数据候选只由社交元数据开关控制。
test("社交元数据过滤可以独立关闭", () => {
	for (const item of [
		candidate("@xudong8834"),
		candidate("4h"),
		candidate("@xudong8834 15m"),
		candidate("Yesterday", { metadataOnly: true }),
	]) {
		assert.equal(shouldSkipCandidate(item, ENABLED_FILTERS), true, item.text);
		assert.equal(
			shouldSkipCandidate(item, filters({ skipSocialMetadata: false })),
			false,
			item.text,
		);
	}
	assert.equal(shouldSkipCandidate(candidate("4h battery life"), ENABLED_FILTERS), false);
	for (const ambiguousMeasurement of ["15m", "12m", "1.8m"]) {
		assert.equal(
			shouldSkipCandidate(candidate(ambiguousMeasurement), ENABLED_FILTERS),
			false,
			ambiguousMeasurement,
		);
	}
});

// 验证短链接按空白片段计数，三个以内跳过，仓库标识仍只算一个片段。
test("短链接过滤使用三片段闭区间", () => {
	const shortLinkFilters = filters({ skipTechnicalIdentifiers: false, skipSocialMetadata: false });
	for (const text of [
		"Docs",
		"Read docs",
		"Read useful docs",
		"yuukiLike/cc-md-vault",
	]) {
		assert.equal(
			shouldSkipCandidate(candidate(text, { interactiveKind: "link" }), shortLinkFilters),
			true,
			text,
		);
	}
	assert.equal(
		shouldSkipCandidate(
			candidate("Read complete project docs", { interactiveKind: "link" }),
			shortLinkFilters,
		),
		false,
	);
	assert.equal(
		shouldSkipCandidate(
			candidate("Read docs", { interactiveKind: "link" }),
			filters({ skipTechnicalIdentifiers: false, skipSocialMetadata: false, skipShortLinks: false }),
		),
		false,
	);
	assert.equal(
		shouldSkipCandidate(candidate("Read docs", { interactiveKind: "link" }), {}),
		true,
	);
});

// 验证短按钮不再受旧开关或缺失字段影响，同时短链接仍保留字符边界规则。
test("短按钮始终进入翻译判断且短链接保持字符边界", () => {
	const optionalFilters = filters({ skipTechnicalIdentifiers: false, skipSocialMetadata: false });
	for (const legacyFilters of [
		optionalFilters,
		{ ...optionalFilters, skipShortButtons: true },
		{ ...optionalFilters, skipShortButtons: false },
		{},
	]) {
		assert.equal(
			shouldSkipCandidate(
				candidate("Try it now", { interactiveKind: "button" }),
				legacyFilters,
			),
			false,
		);
	}
	for (const text of ["Résumé docs", "查看 文档"]) {
		assert.equal(
			shouldSkipCandidate(candidate(text, { interactiveKind: "link" }), optionalFilters),
			false,
			text,
		);
	}
	assert.equal(shouldSkipCandidate(candidate("Read docs"), optionalFilters), false);
});

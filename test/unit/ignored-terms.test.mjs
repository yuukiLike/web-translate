import assert from "node:assert/strict";
import test from "node:test";

import {
	IGNORED_TRANSLATION_TERMS,
	isIgnoredTranslationTerm,
} from "../../src/content/translation/ignored-terms.js";

// 验证专用配置中的版本、技术词和品牌词按完整文本且不区分大小写跳过。
test("免翻译术语使用独立配置精确匹配", () => {
	for (const term of [
		"v1",
		"V2",
		"bug",
		"BUG",
		"API",
		"github",
		"OpenAPI",
		"open",
		"CLOSED",
		"linux",
		"WINDOWS",
		"main branch",
		"CODE",
		"Add File",
		"star",
		"fork",
		"watch",
	]) {
		assert.equal(isIgnoredTranslationTerm(term), true, term);
	}
	assert.ok(IGNORED_TRANSLATION_TERMS.includes("bug"));
	assert.ok(IGNORED_TRANSLATION_TERMS.includes("v1"));
	assert.ok(IGNORED_TRANSLATION_TERMS.includes("v2"));
});

// 验证术语只在独立出现时跳过，不会误伤包含相同单词的正常句子。
test("免翻译术语不会误伤完整句子或相似单词", () => {
	for (const prose of [
		"Fix this bug",
		"v2 documentation",
		"debug",
		"GitHub integration",
		"Open the settings",
		"Closed yesterday",
		"Linux documentation",
		"Add file to repository",
		"Watch this project",
	]) {
		assert.equal(isIgnoredTranslationTerm(prose), false, prose);
	}
});

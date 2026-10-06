import assert from "node:assert/strict";
import test from "node:test";

import { parseModelTranslations } from "../../src/core/model-response.js";
import { splitText } from "../../src/core/text.js";

const source = "See [[BT_LINK_0]]#1772[[/BT_LINK_0]] and [[BT_LINK_1]]3dcead8[[/BT_LINK_1]].";

function parseTranslation(text) {
	return parseModelTranslations(JSON.stringify({ translations: [{ id: "first", text }] }), ["first"], [source]);
}

// 验证模型可翻译链接标签，但不能删除、复制、重排或伪造链接身份。
test("模型结果严格保留链接标记和顺序", () => {
	const translated = "见 [[BT_LINK_0]]#1772[[/BT_LINK_0]] 和 [[BT_LINK_1]]3dcead8[[/BT_LINK_1]]。";
	assert.deepEqual(parseTranslation(translated), [translated]);
	for (const invalid of [
		"见 #1772 和 3dcead8。",
		translated.replace("[[BT_LINK_0]]", ""),
		translated.replace("[[BT_LINK_1]]", "[[BT_LINK_2]]"),
		translated + " [[BT_LINK_0]]重复[[/BT_LINK_0]]",
		"见 [[BT_LINK_1]]3dcead8[[/BT_LINK_1]] 和 [[BT_LINK_0]]#1772[[/BT_LINK_0]]。",
	]) {
		assert.throws(() => parseTranslation(invalid), (error) => error.code === "MODEL_RESPONSE_INVALID" && /链接标记/u.test(error.message));
	}
});

// 验证原文没有链接标记时拒绝模型擅自添加链接，避免使用虚构的链接身份。
test("普通文本不接受模型新增的链接标记", () => {
	assert.throws(() => parseModelTranslations(
		JSON.stringify({ translations: [{ id: "first", text: "见 [[BT_LINK_0]]文档[[/BT_LINK_0]]。" }] }),
		["first"],
		["Read the docs."],
	), (error) => error.code === "MODEL_RESPONSE_INVALID");
});

// 验证长文本与恢复拆批的每个切点都不会切断标记，分片仍可无损拼回。
test("文本分片把每个链接标记保留在同一片内", () => {
	const text = `${"a".repeat(25)}[[BT_LINK_0]]#1772[[/BT_LINK_0]]${"b".repeat(25)}`;
	for (const maximum of [20, 30, 35, 40, 50]) {
		const parts = splitText(text, maximum);
		assert.equal(parts.join(""), text);
		assert.ok(parts.every((part) => part.length <= maximum));
		assert.equal(parts.filter((part) => part.includes("[[BT_LINK_0]]")).length, 1);
		assert.equal(parts.filter((part) => part.includes("[[/BT_LINK_0]]")).length, 1);
	}
});

import assert from "node:assert/strict";
import test from "node:test";

import {
	changeSourceLanguage,
	changeTargetLanguage,
	parseLanguagePair,
} from "../../src/popup/language-pair.js";

// 验证自动输入可以独立选择中英文输出，同时拒绝固定语言的同语种翻译。
test("Popup 语言对只接受四种有意义组合", () => {
	assert.deepEqual(parseLanguagePair({ sourceMode: "auto", targetLanguage: "zh" }), {
		sourceMode: "auto",
		targetLanguage: "zh",
	});
	assert.deepEqual(parseLanguagePair({ sourceMode: "auto", targetLanguage: "en" }), {
		sourceMode: "auto",
		targetLanguage: "en",
	});
	assert.throws(
		() => parseLanguagePair({ sourceMode: "zh", targetLanguage: "zh" }),
		/语言配置无效/u,
	);
});

// 验证输入语言改成与输出相同时自动翻转输出，避免产生无意义组合。
test("Popup 修改输入语言时保持有效方向", () => {
	assert.deepEqual(
		changeSourceLanguage({ sourceMode: "auto", targetLanguage: "zh" }, "zh"),
		{ sourceMode: "zh", targetLanguage: "en" },
	);
	assert.deepEqual(
		changeSourceLanguage({ sourceMode: "zh", targetLanguage: "en" }, "auto"),
		{ sourceMode: "auto", targetLanguage: "en" },
	);
});

// 验证输出语言改成与固定输入相同时自动翻转输入，并为自动检测保留用户选择。
test("Popup 修改输出语言时保持有效方向", () => {
	assert.deepEqual(
		changeTargetLanguage({ sourceMode: "en", targetLanguage: "zh" }, "en"),
		{ sourceMode: "zh", targetLanguage: "en" },
	);
	assert.deepEqual(
		changeTargetLanguage({ sourceMode: "auto", targetLanguage: "zh" }, "en"),
		{ sourceMode: "auto", targetLanguage: "en" },
	);
});

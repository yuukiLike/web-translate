import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPopupPageHarness } from "../helpers/popup-page-harness.mjs";

// 控件继续由浏览器管理键盘、焦点和选中状态，不引入平行的按钮/列表状态。
test("Popup 语言菜单保留唯一的原生值、标签和选项集合", async () => {
	const page = await createPopupPageHarness();
	try {
		const fields = page.document.querySelector("#language-fields");
		for (const [id, values] of [
			["source-language", ["auto", "en", "zh"]],
			["target-language", ["zh", "en"]],
		]) {
			const select = fields.querySelector(`#${id}`);
			assert.equal(select.tagName, "SELECT");
			assert.ok(select.labels.length > 0);
			assert.equal(select.hasAttribute("role"), false);
			assert.equal(select.hasAttribute("aria-activedescendant"), false);
			assert.deepEqual([...select.options].map(({ value }) => value), values);
			assert.equal([...select.options].filter(({ selected }) => selected).length, 1);
		}
		assert.equal(fields.querySelectorAll("button, [role=listbox], [role=option]").length, 0);
	} finally {
		page.cleanup();
	}
});

// 同时启用控件和菜单的 base-select，避免再次弹出继承 28px 展示字号的系统菜单。
test("Popup 自定义原生菜单符合最低 Chrome 版本并独立设置选项字号", async () => {
	const [manifestText, popupCss, pickerCss] = await Promise.all([
		readFile(new URL("../../chrome-extension/manifest.json", import.meta.url), "utf8"),
		readFile(new URL("../../src/popup/popup.css", import.meta.url), "utf8"),
		readFile(new URL("../../src/popup/language-picker.css", import.meta.url), "utf8"),
	]);
	assert.ok(Number.parseInt(JSON.parse(manifestText).minimum_chrome_version, 10) >= 135);
	assert.match(popupCss, /@import "\.\/language-picker\.css"/u);
	assert.match(
		pickerCss,
		/\.language-field select,\s*\.language-field select::picker\(select\)\s*\{\s*appearance: base-select;/u,
	);
	const optionRule = /\.language-field option\s*\{([^}]+)\}/u.exec(pickerCss)?.[1];
	const optionSize = /font:\s*500 (\d+)px/u.exec(optionRule)?.[1];
	assert.ok(Number(optionSize) >= 12 && Number(optionSize) <= 16);
	assert.match(pickerCss, /option:checked/u);
	assert.match(pickerCss, /option:focus-visible/u);
	assert.match(pickerCss, /@media \(forced-colors: active\)/u);
});

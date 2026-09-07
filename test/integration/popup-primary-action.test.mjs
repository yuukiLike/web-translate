import assert from "node:assert/strict";
import test from "node:test";

import {
	createPopupPageHarness,
	waitFor,
} from "../helpers/popup-page-harness.mjs";

// 验证先选择语言再执行翻译的自然操作顺序，并通过原生控件关联标签、说明和状态。
test("Popup 语言选择与主操作提供连贯的可访问语义", async () => {
	const page = await createPopupPageHarness();
	try {
		const card = page.document.querySelector(".reader-card");
		const fields = page.document.querySelector("#language-fields");
		const toggle = page.document.querySelector("#toggle-translation");
		const status = page.document.querySelector("#popup-status");
		assert.deepEqual(
			[...card.querySelectorAll("select, button")].map(({ id }) => id),
			["source-language", "target-language", "toggle-translation"],
		);
		assert.equal(fields.tagName, "FIELDSET");
		assert.equal(fields.querySelector("legend").textContent, "默认语言方向");
		assert.equal(fields.getAttribute("aria-describedby"), "language-note");
		assert.ok(page.document.querySelector("#language-note").textContent.trim());
		for (const [id, label] of [["source-language", "输入语言"], ["target-language", "输出语言"]]) {
			const select = fields.querySelector(`#${id}`);
			assert.equal(select.tagName, "SELECT");
			assert.equal(fields.querySelector(`label[for="${id}"] > span`).textContent, label);
			assert.equal(select.hasAttribute("tabindex"), false);
		}

		assert.equal(toggle.getAttribute("aria-describedby"), status.id);
		assert.equal(status.getAttribute("role"), "status");
		assert.equal(status.getAttribute("aria-live"), "polite");
		assert.equal(status.getAttribute("aria-atomic"), "true");
	} finally {
		page.cleanup();
	}
});

// 验证翻译期间主按钮公开忙碌语义，并锁定语言选择避免并发改向。
test("Popup 主翻译操作公开忙碌状态并锁定语言", async () => {
	const response = Promise.withResolvers();
	const page = await createPopupPageHarness({
		toggleActiveTab: () => response.promise,
	});
	try {
		const toggle = page.document.querySelector("#toggle-translation");
		const languageFields = page.document.querySelector("#language-fields");
		await waitFor(() => !toggle.disabled, "Popup 主操作未进入就绪态");

		toggle.click();
		await waitFor(
			() => toggle.getAttribute("aria-busy") === "true",
			"Popup 主操作没有进入忙碌态",
		);
		assert.equal(languageFields.disabled, true);
		assert.match(page.document.querySelector("#popup-status").textContent, /正在翻译当前网页/u);

		response.resolve({ ok: false, error: "模拟翻译失败" });
		await waitFor(
			() => toggle.getAttribute("aria-busy") === "false",
			"Popup 主操作没有退出忙碌态",
		);
		assert.equal(languageFields.disabled, false);
		assert.equal(toggle.disabled, false);
	} finally {
		response.resolve({ ok: false, error: "模拟翻译失败" });
		page.cleanup();
	}
});

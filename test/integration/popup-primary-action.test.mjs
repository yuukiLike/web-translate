import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	createPopupPageHarness,
	waitFor,
} from "../helpers/popup-page-harness.mjs";

const popupStylesUrl = new URL(
	"../../chrome-extension/popup/popup.css",
	import.meta.url,
);

// 验证主翻译操作位于卡片首位，并占据完整宽度和足够大的点击区域。
test("Popup 首屏使用全宽大号翻译按钮", async () => {
	const page = await createPopupPageHarness();
	try {
		const card = page.document.querySelector(".reader-card");
		const toggle = page.document.querySelector("#toggle-translation");
		assert.equal(card.firstElementChild?.id, toggle.id);
		assert.equal(toggle.nextElementSibling?.classList.contains("language-panel"), true);

		const styles = await readFile(popupStylesUrl, "utf8");
		assert.match(styles, /\.main-action\{[^}]*width:100%/u);
		assert.match(styles, /\.main-action\{[^}]*min-height:80px/u);
		assert.match(styles, /\.main-action strong\{[^}]*font-size:18px/u);
	} finally {
		page.cleanup();
	}
});

// 验证翻译期间主按钮保持高对比忙碌语义，并锁定语言选择避免并发改向。
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

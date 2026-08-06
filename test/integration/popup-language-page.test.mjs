import assert from "node:assert/strict";
import test from "node:test";

import {
	createDeferred,
	createPopupPageHarness,
	waitFor,
} from "../helpers/popup-page-harness.mjs";

function changeSelect(page, selector, value) {
	const select = page.document.querySelector(selector);
	select.value = value;
	select.dispatchEvent(new page.window.Event("change", { bubbles: true }));
	return select;
}

async function waitUntilLanguageControlsReady(page) {
	await waitFor(
		() => !page.document.querySelector("#language-fields").disabled,
		"Popup 语言选择器未就绪",
	);
}

function languageMessages(page) {
	return page.calls.filter(({ type }) => type === "SET_LANGUAGE_PAIR");
}

function isFormControlDisabled(control) {
	return control.disabled || control.closest("fieldset")?.disabled === true;
}

// 验证固定输入语言不会与输出语言相同，并把自动检测到中文的方向调整为中译英。
test("Popup 将 auto→zh 的输入语言改为中文时自动调整为 zh→en", async () => {
	const page = await createPopupPageHarness();
	try {
		await waitUntilLanguageControlsReady(page);
		changeSelect(page, "#source-language", "zh");
		await waitFor(() => languageMessages(page).length === 1, "Popup 未保存输入语言");
		await waitFor(
			() => page.document.querySelector("#popup-status").textContent.includes("下次翻译生效"),
			"Popup 未确认语言方向已经保存",
		);

		assert.deepEqual(languageMessages(page), [
			{ type: "SET_LANGUAGE_PAIR", sourceMode: "zh", targetLanguage: "en" },
		]);
		assert.equal(page.document.querySelector("#source-language").value, "zh");
		assert.equal(page.document.querySelector("#target-language").value, "en");
		assert.match(page.document.querySelector("#popup-status").textContent, /下次翻译生效/u);
	} finally {
		page.cleanup();
	}
});

// 验证修改输出语言时保留自动检测输入，允许用户直接配置 auto→en。
test("Popup 将 auto→zh 的输出语言改为英文时保持 auto→en", async () => {
	const page = await createPopupPageHarness();
	try {
		await waitUntilLanguageControlsReady(page);
		changeSelect(page, "#target-language", "en");
		await waitFor(() => languageMessages(page).length === 1, "Popup 未保存输出语言");

		assert.deepEqual(languageMessages(page), [
			{ type: "SET_LANGUAGE_PAIR", sourceMode: "auto", targetLanguage: "en" },
		]);
		assert.equal(page.document.querySelector("#source-language").value, "auto");
		assert.equal(page.document.querySelector("#target-language").value, "en");
	} finally {
		page.cleanup();
	}
});

// 验证语言方向保存期间锁定全部相关操作，重复事件不会发起第二次保存或网页翻译。
test("Popup 保存语言方向时禁用选择器与主操作并阻止重复请求", async () => {
	const saved = createDeferred();
	const page = await createPopupPageHarness({ setLanguagePair: () => saved.promise });
	try {
		await waitUntilLanguageControlsReady(page);
		const source = changeSelect(page, "#source-language", "zh");
		await waitFor(() => languageMessages(page).length === 1, "Popup 未开始保存语言方向");

		const target = page.document.querySelector("#target-language");
		const toggle = page.document.querySelector("#toggle-translation");
		assert.equal(page.document.querySelector("#language-fields").disabled, true);
		assert.equal(isFormControlDisabled(source), true);
		assert.equal(isFormControlDisabled(target), true);
		assert.equal(toggle.disabled, true);

		source.dispatchEvent(new page.window.Event("change", { bubbles: true }));
		target.dispatchEvent(new page.window.Event("change", { bubbles: true }));
		toggle.click();
		assert.equal(languageMessages(page).length, 1);
		assert.equal(page.calls.some(({ type }) => type === "TOGGLE_ACTIVE_TAB"), false);

		saved.resolve({
			ok: true,
			popupProtocolVersion: 2,
			languagePair: { sourceMode: "zh", targetLanguage: "en" },
		});
		await waitUntilLanguageControlsReady(page);
		assert.equal(toggle.disabled, false);
	} finally {
		saved.resolve({
			ok: true,
			popupProtocolVersion: 2,
			languagePair: { sourceMode: "zh", targetLanguage: "en" },
		});
		page.cleanup();
	}
});

// 验证后台拒绝保存时回滚到上一次成功配置，并恢复语言选择器与主操作。
test("Popup 保存语言方向失败后恢复已保存组合", async () => {
	const page = await createPopupPageHarness({
		setLanguagePair: async () => ({ ok: false, error: "模拟保存失败" }),
	});
	try {
		await waitUntilLanguageControlsReady(page);
		changeSelect(page, "#target-language", "en");
		await waitFor(
			() => page.document.querySelector("#popup-status").textContent.includes("模拟保存失败"),
			"Popup 未展示保存错误",
		);

		assert.equal(page.document.querySelector("#source-language").value, "auto");
		assert.equal(page.document.querySelector("#target-language").value, "zh");
		assert.equal(page.document.querySelector("#language-fields").disabled, false);
		assert.equal(page.document.querySelector("#toggle-translation").disabled, false);
		assert.equal(page.document.querySelector("#popup-status").dataset.error, "true");
	} finally {
		page.cleanup();
	}
});

// 验证旧后台即使返回 ok:true，缺少版本化语言字段时仍会进入明确的重新载入状态。
test("Popup 将缺少新语言协议的成功响应识别为版本错配", async () => {
	const page = await createPopupPageHarness({
		getPopupState: async () => ({
			ok: true,
			version: "0.3.0",
			providerLabel: "DeepSeek",
			targetLanguage: "简体中文",
			configured: true,
			canTranslate: true,
		}),
	});
	try {
		await waitFor(
			() => page.document.querySelector("#current-provider").textContent === "后台版本未同步",
			"Popup 未识别旧版成功响应",
		);

		const toggle = page.document.querySelector("#toggle-translation");
		assert.equal(page.document.querySelector("#language-fields").disabled, true);
		assert.equal(page.document.querySelector("#current-model").textContent, "重新载入扩展后再试");
		assert.match(page.document.querySelector("#popup-status").textContent, /重新载入/u);
		assert.equal(toggle.disabled, false);
		assert.match(toggle.textContent, /重新载入扩展/u);
		assert.equal(toggle.getAttribute("aria-label"), "重新载入扩展");
	} finally {
		page.cleanup();
	}
});

// 验证语言保存时才发现旧后台协议，恢复入口仍可点击而不会被保存锁永久禁用。
test("Popup 保存语言时遇到协议错配仍允许重新载入", async () => {
	const page = await createPopupPageHarness({
		setLanguagePair: async () => ({ ok: false, error: "未知消息类型" }),
	});
	try {
		await waitUntilLanguageControlsReady(page);
		changeSelect(page, "#target-language", "en");
		await waitFor(
			() => page.document.querySelector("#current-provider").textContent === "后台版本未同步",
			"Popup 未从语言保存协议错配进入恢复状态",
		);

		const toggle = page.document.querySelector("#toggle-translation");
		assert.equal(page.document.querySelector("#language-fields").disabled, true);
		assert.equal(toggle.disabled, false);
		assert.equal(toggle.getAttribute("aria-label"), "重新载入扩展");
		toggle.click();
		await waitFor(() => page.reloadCount === 1, "Popup 未执行协议恢复重载");
	} finally {
		page.cleanup();
	}
});

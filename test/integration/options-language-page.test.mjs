import assert from "node:assert/strict";
import test from "node:test";

import {
	chooseProvider,
	createOptionsPageHarness,
	inputValue,
	settle,
	waitFor,
} from "../helpers/options-page-harness.mjs";

function selectValue(page, selector, value) {
	const select = page.document.querySelector(selector);
	select.value = value;
	select.dispatchEvent(new page.window.Event("change", { bubbles: true }));
}

// 输入与输出语言必须独立可选；用户选出固定同语方向时，界面应立即调整另一端。
test("设置页提供独立语言选择并阻止固定同语组合", async () => {
	const page = await createOptionsPageHarness();
	try {
		const source = page.document.querySelector("#source-mode");
		const target = page.document.querySelector("#target-mode");
		assert.deepEqual(
			[...source.options].map((option) => option.value),
			["auto", "zh", "en"],
		);
		assert.deepEqual(
			[...target.options].map((option) => option.value),
			["zh", "en"],
		);

		selectValue(page, "#source-mode", "zh");
		await settle();
		assert.equal(source.value, "zh");
		assert.equal(target.value, "en");

		selectValue(page, "#target-mode", "zh");
		await settle();
		assert.equal(source.value, "en");
		assert.equal(target.value, "zh");
	} finally {
		page.cleanup();
	}
});

// Popup 修改语言后，设置页必须接收最新方向，同时保留用户尚未保存的 Provider 草稿。
test("外部语言变更同步到草稿且不会覆盖其他未保存设置", async () => {
	const page = await createOptionsPageHarness();
	try {
		await chooseProvider(page.window, page.document, "openai");
		inputValue(page.window, page.document.querySelector("#openai-api-key"), "openai-draft-key");
		const externalSettings = page.core.normalizeSettings({
			provider: "deepseek",
			sourceMode: "auto",
			targetMode: "en",
			deepseek: { apiKey: "external-deepseek-key" },
		});
		page.storageChanged.emit(
			{ [page.core.SETTINGS_KEY]: { newValue: externalSettings } },
			"local",
		);
		await settle();

		assert.equal(page.document.querySelector("#source-mode").value, "auto");
		assert.equal(page.document.querySelector("#target-mode").value, "en");
		assert.equal(page.document.querySelector("#provider-openai").checked, true);
		assert.equal(page.document.querySelector("#openai-api-key").value, "openai-draft-key");

		page.clearCalls();
		page.document.querySelector("#test-provider").click();
		await waitFor(
			() => page.document.querySelector("#status").textContent.includes("连接成功"),
			"保存语言方向后的连接测试未完成",
		);
		const savedSettings = page.calls.find((message) => message.type === "SAVE_SETTINGS").settings;
		assert.equal(savedSettings.sourceMode, "auto");
		assert.equal(savedSettings.targetMode, "en");
		assert.equal(savedSettings.provider, "openai");
		assert.equal(savedSettings.openai.apiKey, "openai-draft-key");
	} finally {
		page.cleanup();
	}
});

// 初始化读取若晚于新的 storage 事件返回，不得用旧快照覆盖 Popup 刚保存的语言方向。
test("设置页忽略晚到初始化响应中的旧语言方向", async () => {
	const page = await createOptionsPageHarness({
		getOptionsState({ core, settings, storageChanged, usage }) {
			const latest = core.normalizeSettings({
				...settings,
				sourceMode: "auto",
				targetMode: "en",
			});
			storageChanged.emit(
				{ [core.SETTINGS_KEY]: { newValue: latest } },
				"local",
			);
			return { ok: true, settings: structuredClone(settings), usage };
		},
	});
	try {
		assert.equal(page.document.querySelector("#source-mode").value, "auto");
		assert.equal(page.document.querySelector("#target-mode").value, "en");
	} finally {
		page.cleanup();
	}
});

// 新设置页遇到不认识语言消息的旧后台时，应提供可点击重载而不是继续保存错误语义。
test("设置页把旧后台协议错误转换为重新载入操作", async () => {
	let reloadCount = 0;
	const page = await createOptionsPageHarness({
		onReload: () => {
			reloadCount += 1;
		},
		setLanguagePair: async () => ({ ok: false, error: "未知消息类型" }),
	});
	try {
		page.clearCalls();
		const submit = page.document.querySelector("#test-provider");
		submit.click();
		await waitFor(
			() => page.document.querySelector("#status").textContent.includes("后台版本未同步"),
			"设置页未识别旧后台协议",
		);

		assert.deepEqual(page.calls.map(({ type }) => type), ["SET_LANGUAGE_PAIR"]);
		assert.match(submit.textContent, /重新载入扩展/u);
		submit.click();
		await waitFor(() => reloadCount === 1, "设置页未重新载入扩展");
	} finally {
		page.cleanup();
	}
});

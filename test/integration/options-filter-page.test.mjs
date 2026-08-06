import assert from "node:assert/strict";
import test from "node:test";

import {
	createOptionsPageHarness,
	settle,
	waitFor,
} from "../helpers/options-page-harness.mjs";

const FILTER_INPUTS = {
	skipTechnicalIdentifiers: "#filter-technical-identifiers",
	skipSocialMetadata: "#filter-social-metadata",
	skipShortLinks: "#filter-short-links",
	skipShortButtons: "#filter-short-buttons",
};

function changeCheckbox(page, selector, checked) {
	const input = page.document.querySelector(selector);
	assert.ok(input, `缺少内容过滤开关 ${selector}`);
	input.checked = checked;
	input.dispatchEvent(new page.window.Event("change", { bubbles: true }));
}

// 验证设置页展示四个默认开启的过滤开关，并明确固定短控件阈值与纯数字规则。
test("内容过滤设置展示完整默认值和固定规则说明", async () => {
	const page = await createOptionsPageHarness();
	try {
		const section = page.document.querySelector("#content-filters");
		assert.ok(section);
		for (const selector of Object.values(FILTER_INPUTS)) {
			assert.equal(page.document.querySelector(selector)?.checked, true, selector);
		}
		assert.match(section.textContent, /3 个以内（含 3 个）/u);
		assert.match(section.textContent, /纯数字与计数始终跳过/u);
	} finally {
		page.cleanup();
	}
});

// 验证局部旧设置会补齐其余开关，关闭两个选项后保存仍提交完整嵌套对象。
test("内容过滤草稿完整保存且不会因浅合并丢字段", async () => {
	const page = await createOptionsPageHarness({
		settings: {
			provider: "deepseek",
			deepseek: { apiKey: "deepseek-key", model: "deepseek-v4-flash" },
			contentFilters: { skipShortLinks: false },
		},
	});
	try {
		assert.equal(page.document.querySelector(FILTER_INPUTS.skipTechnicalIdentifiers).checked, true);
		assert.equal(page.document.querySelector(FILTER_INPUTS.skipSocialMetadata).checked, true);
		assert.equal(page.document.querySelector(FILTER_INPUTS.skipShortLinks).checked, false);
		assert.equal(page.document.querySelector(FILTER_INPUTS.skipShortButtons).checked, true);

		changeCheckbox(page, FILTER_INPUTS.skipSocialMetadata, false);
		changeCheckbox(page, FILTER_INPUTS.skipShortButtons, false);
		await settle();
		page.clearCalls();
		page.document.querySelector("#test-provider").click();
		await waitFor(
			() => page.document.querySelector("#status").textContent.includes("连接成功"),
			"内容过滤设置没有完成保存",
		);

		const saved = page.calls.find((message) => message.type === "SAVE_SETTINGS");
		assert.deepEqual(saved?.settings.contentFilters, {
			skipTechnicalIdentifiers: true,
			skipSocialMetadata: false,
			skipShortLinks: false,
			skipShortButtons: false,
		});
	} finally {
		page.cleanup();
	}
});

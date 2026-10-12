import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const fixture = readFileSync(new URL("../fixtures/github-commit-description.html", import.meta.url), "utf8");
const BODY_SELECTOR = ".extended-commit-description-container";
const BODY_START = "* fix(wasm): preserve debug module names in WABT output";
const ALL_FILTERS_DISABLED = { skipShortLinks: false, skipSocialMetadata: false, skipTechnicalIdentifiers: false };

// 验证原生 div 说明单独翻译，不落入卡片窄列；关闭过滤时仍保留正文换行与标题引用。
test("GitHub commits 初始展开说明保持独立正文块", async () => {
	for (const contentFilters of [{}, ALL_FILTERS_DISABLED]) {
		const harness = createContentHarness({ contentFilters });
		try {
			const card = installCard(harness);
			card.toggle.click();
			const body = card.row.querySelector(BODY_SELECTOR);
			const bodyText = body.textContent;
			harness.start();
			await waitFor(() => card.row.querySelectorAll(".bt-translation").length === 2, "展开提交没有完成翻译");

			assertBodyPlacement(harness, card, body, bodyText);
			assert.equal(requestedTexts(harness).includes(bodyText), true, "说明应整段提交并保留原换行");
			assert.equal(bodyText.includes("\n\n"), true);
			assert.equal(harness.requestCount(bodyText), 1);
		} finally {
			harness.dispose();
		}
	}
});

// 验证先翻译标题再点击展开、收起和再次展开时，仅重建说明，缓存复用且标题保持原节点。
test("GitHub commits 点击展开收起后再次展开不破坏卡片", async () => {
	const harness = createContentHarness();
	try {
		const card = installCard(harness);
		harness.start();
		await waitFor(() => harness.getTranslation(card.title), "折叠卡片标题没有翻译");
		const titleTranslation = harness.getTranslation(card.title);
		assert.equal(requestedTexts(harness).some((text) => text.startsWith(BODY_START)), false);

		for (let cycle = 0; cycle < 2; cycle += 1) {
			card.toggle.click();
			const body = card.row.querySelector(BODY_SELECTOR);
			const bodyText = body.textContent;
			await waitFor(() => card.row.querySelectorAll(".bt-translation").length === 2, "点击展开后说明没有翻译");
			assertBodyPlacement(harness, card, body, bodyText);
			assert.equal(harness.getTranslation(card.title) === titleTranslation, true, "展开说明不应重建标题译文");
			assert.equal(harness.requestCount(bodyText), 1, "再次展开应复用说明译文缓存");

			card.toggle.click();
			await waitFor(() => body.dataset.btSource === undefined, "收起后说明状态没有清理");
			assert.equal(card.row.querySelector(BODY_SELECTOR) === null, true, "收起后原生说明应卸载");
			assert.equal(card.row.querySelectorAll(".bt-translation").length, 1, "收起后不能遗留说明译文");
			assert.equal(harness.getTranslation(card.title) === titleTranslation, true, "收起说明不应重建标题译文");
		}
	} finally {
		harness.dispose();
	}
});

// 验证说明内的普通文本、链接与行内代码归属同一正文块，说明更新不会合并进卡片。
test("GitHub commits 展开说明保留行内链接并同步正文更新", async () => {
	const harness = createContentHarness();
	try {
		const card = installCard(harness);
		card.toggle.click();
		const body = card.row.querySelector(BODY_SELECTOR);
		body.innerHTML = '* Read <a href="/morluto/rea/pull/1967">the implementation notes</a> before changing <code>WABT</code>.\n\nKeep the module names intact.';
		const bodyText = body.textContent;
		harness.start();
		await waitFor(() => card.row.querySelectorAll(".bt-translation").length === 2, "带链接的提交说明没有翻译");
		assertBodyPlacement(harness, card, body, bodyText);
		const translation = harness.getTranslation(body);
		assert.equal(translation.querySelector("a")?.href, "https://github.com/morluto/rea/pull/1967");
		assert.equal(translation.querySelector("a")?.textContent, "the implementation notes");
		assert.equal(translation.closest("a") === null, true, "整段说明不应归属于其中的链接");

		const updatedText = "* Clarify the module naming behavior.\n\nKeep this description paired with its translation.";
		body.textContent = updatedText;
		await waitFor(() => harness.getTranslation(body)?.textContent === `译文：${updatedText}`, "说明更新没有同步译文");
		assertBodyPlacement(harness, card, body, updatedText);
		assert.equal(harness.getTranslation(body).querySelector("a") === null, true, "更新后不应残留旧链接");
	} finally {
		harness.dispose();
	}
});

// 验证说明请求尚未返回就收起时，不插入迟到译文；再次展开仍能正常显示说明。
test("GitHub commits 收起待返回说明不遗留译文", async () => {
	const deferred = Promise.withResolvers();
	const harness = createContentHarness({
		translateText: (text) => text.startsWith(BODY_START) ? deferred.promise : `译文：${text}`,
	});
	try {
		const card = installCard(harness);
		harness.start();
		await waitFor(() => harness.getTranslation(card.title), "标题没有完成翻译");
		const titleTranslation = harness.getTranslation(card.title);
		card.toggle.click();
		const body = card.row.querySelector(BODY_SELECTOR);
		const bodyText = body.textContent;
		await waitFor(() => requestedTexts(harness).some((text) => text.startsWith(BODY_START)), "说明没有提交待返回请求");
		card.toggle.click();
		deferred.resolve(`译文：${bodyText}`);
		const sentinel = harness.document.createElement("p");
		sentinel.textContent = "A note loaded after the commit description was collapsed.";
		harness.root.append(sentinel);
		await waitFor(() => harness.getTranslation(sentinel), "收起后的扫描没有完成");
		assert.equal(card.row.querySelectorAll(":scope > .bt-translation").length, 0, "迟到译文不能进入网格");
		assert.equal(card.row.querySelectorAll(".bt-translation").length, 1, "收起后只应保留标题译文");
		assert.equal(body.dataset.btSource, undefined, "卸载说明的状态应清理");

		card.toggle.click();
		const restoredBody = card.row.querySelector(BODY_SELECTOR);
		await waitFor(() => harness.getTranslation(restoredBody), "再次展开说明没有恢复译文");
		assertBodyPlacement(harness, card, restoredBody, bodyText);
		assert.equal(harness.getTranslation(card.title) === titleTranslation, true, "迟到响应不应影响标题");
	} finally {
		harness.dispose();
	}
});

function installCard(harness) {
	harness.window.location.href = "https://github.com/yuukiLike/rea/commits/main/";
	harness.root.innerHTML = fixture;
	const row = harness.root.querySelector("[data-testid='commit-row-item']");
	const title = row.querySelector("h4");
	const mainContent = row.querySelector("[class*='MainContent-module__inner__']");
	const template = harness.root.querySelector("template");
	const toggle = row.querySelector("[data-testid='commit-row-show-description-button']");
	let description = null;
	// 模拟原生 CommitRow 的条件挂载：说明是 attribution 前的独立 Description 子项。
	toggle.addEventListener("click", () => {
		if (description) {
			description.remove();
			description = null;
		} else {
			description = template.content.firstElementChild.cloneNode(true);
			mainContent.prepend(description);
		}
		toggle.setAttribute("aria-expanded", String(Boolean(description)));
		toggle.setAttribute("aria-pressed", String(Boolean(description)));
	});
	return { row, title, mainContent, toggle, titleLinks: [...title.querySelectorAll("a")] };
}

function assertBodyPlacement(harness, card, body, bodyText) {
	assert.equal(card.row.querySelectorAll(":scope > .bt-translation").length, 0,
		"展开说明的译文不能作为网格子项落入左侧窄列");
	assert.equal(card.row.dataset.btSource, undefined, "展开正文不能使整张卡片成为源块");
	const translation = harness.getTranslation(body);
	assert.equal(Boolean(translation), true, "说明容器应生成独立译文");
	assert.equal(translation.previousElementSibling === body, true, "译文应紧跟原说明容器");
	assert.equal(card.mainContent.contains(translation), true, "说明译文必须位于主内容区域");
	assert.equal(translation.textContent, `译文：${bodyText}`);
	assert.equal(card.row.querySelectorAll(".bt-translation").length, 2, "每张卡片只应有标题和说明两段译文");
	assert.equal(card.titleLinks.every((link) => card.title.contains(link)), true, "原标题引用链接应保留原节点");
	assert.equal(card.titleLinks[1].href, "https://github.com/morluto/rea/pull/1967");
	assert.equal(card.titleLinks[1].textContent, "morluto#1967");
}

function requestedTexts(harness) {
	return harness.translationRequests.flatMap(({ texts }) => texts);
}

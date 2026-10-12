import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const fixture = readFileSync(new URL("../fixtures/github-commits.html", import.meta.url), "utf8");
const TITLE = "move to Applications alert++";
const TITLE_TRANSLATION = "移到 Applications 的提示已改进";
const ALL_FILTERS_DISABLED = {
	skipShortLinks: false,
	skipSocialMetadata: false,
	skipTechnicalIdentifiers: false,
};

// 验证真实提交卡片的元信息不会成为窄列译文，标题仍在原链接内且停用后恢复原结构。
test("GitHub commits 保持卡片网格与标题链接", async () => {
	for (const contentFilters of [{}, ALL_FILTERS_DISABLED]) {
		const harness = createContentHarness({ contentFilters, translateText });
		try {
			harness.window.location.href = "https://github.com/objective-see/LuLu/commits/master/";
			harness.root.innerHTML = fixture;
			const card = findCard(harness);
			const originalChildren = [...card.row.children];
			const originalAttribution = card.attribution.innerHTML;
			const originalMetadata = card.metadata.innerHTML;
			harness.start();
			await waitFor(() => harness.getTranslation(card.title), "提交标题没有翻译");

			assertCardLayout(harness, card);
			assert.equal(card.attribution.innerHTML, originalAttribution);
			assert.equal(card.metadata.innerHTML, originalMetadata);
			assert.equal(harness.window.getComputedStyle(card.row).display, "grid");
			assert.deepEqual(requestedTexts(harness).toSorted(), ["Commits on Oct 4, 2026", TITLE].toSorted());

			await harness.window.__bilingualWebTranslatorController.toggle();
			assert.equal(Boolean(card.row.querySelector("[data-bt-owned]")), false);
			assert.equal(card.row.children.length, originalChildren.length);
			assert.equal(originalChildren.every((child, index) => card.row.children[index] === child), true,
				"停用后应保留原网格子项及其顺序");
		} finally {
			harness.dispose();
		}
	}
});

// 验证动态提交与 hydration 继续排除元信息，修改标题只重建标题译文。
test("GitHub commits 动态加载与元信息更新不产生额外网格项", async () => {
	const harness = createContentHarness({ contentFilters: ALL_FILTERS_DISABLED, translateText });
	try {
		harness.window.location.href = "https://github.com/objective-see/LuLu/commits/master/";
		harness.start();
		harness.root.innerHTML = fixture;
		const card = findCard(harness);
		await waitFor(() => harness.getTranslation(card.title), "动态提交没有翻译");
		const initialTranslation = harness.getTranslation(card.title);

		card.attribution.querySelector("relative-time").textContent = "yesterday";
		card.attribution.querySelector("a[href*='?author=']").textContent = "another-author";
		card.metadata.querySelector("[data-component='text']").textContent = "abcd123";
		const sentinel = appendParagraph(harness, harness.root, "Additional commits loaded after hydration.");
		await waitFor(() => harness.getTranslation(sentinel), "hydration 后扫描没有完成");
		assert.equal(harness.getTranslation(card.title) === initialTranslation, true,
			"元信息更新不应重建标题译文");
		assertCardLayout(harness, card);
		assert.deepEqual(requestedTexts(harness).toSorted(), ["Commits on Oct 4, 2026", TITLE, sentinel.firstChild.textContent].toSorted());

		const updatedTitle = "Improve the application alert message";
		card.titleLink.querySelector("span").textContent = updatedTitle;
		await waitFor(() => harness.getTranslation(card.title)?.textContent === `译文：${updatedTitle}`,
			"提交标题更新后译文没有同步");
		assertCardLayout(harness, card, `译文：${updatedTitle}`);
		assert.equal(harness.requestCount(TITLE), 1);
		assert.equal(harness.requestCount(updatedTitle), 1);
	} finally {
		harness.dispose();
	}
});

// 验证排除边界只覆盖作者和操作栏，提交卡片正文与同类列表中的普通正文仍可翻译。
test("GitHub commits 不误伤卡片说明与普通列表正文", async () => {
	const harness = createContentHarness({ contentFilters: ALL_FILTERS_DISABLED, translateText });
	try {
		harness.window.location.href = "https://github.com/objective-see/LuLu/commits/master/";
		harness.root.innerHTML = fixture;
		const card = findCard(harness);
		const description = appendParagraph(harness, card.attribution.parentElement,
			"Explain why the application alert behavior has changed.");
		const normalItem = harness.document.createElement("li");
		normalItem.innerHTML = '<div class="MetadataContainer-module__container__other">A regular list note must remain translatable.</div>';
		harness.root.querySelector("ul").append(normalItem);
		harness.start();
		await waitFor(() => harness.getTranslation(description) && harness.getTranslation(normalItem),
			"卡片说明或普通列表正文被误排除");
		assertCardLayout(harness, card);
		assert.equal(requestedTexts(harness).includes(description.firstChild.textContent), true);
		assert.equal(requestedTexts(harness).includes(normalItem.firstChild.textContent), true);
	} finally {
		harness.dispose();
	}
});

// 验证响应返回前移入元信息区域的普通正文也被最终候选复核拒绝，避免迟到译文破坏卡片。
test("GitHub commits 渲染前重新检查元信息边界", async () => {
	const deferred = Promise.withResolvers();
	const sourceText = "A pending note is moved into the commit metadata.";
	const harness = createContentHarness({
		translateText: (text) => text === sourceText ? deferred.promise : translateText(text),
	});
	try {
		harness.window.location.href = "https://github.com/objective-see/LuLu/commits/master/";
		harness.window.MutationObserver = class {
			observe() {}
			disconnect() {}
			takeRecords() { return []; }
		};
		harness.root.innerHTML = fixture;
		const card = findCard(harness);
		const pending = appendParagraph(harness, harness.root, sourceText);
		harness.start();
		await waitFor(() => harness.requestCount(sourceText) === 1, "待返回正文没有提交翻译");
		card.metadata.append(pending);
		deferred.resolve(`译文：${sourceText}`);
		await waitFor(() => pending.dataset.btSource === undefined && harness.getTranslation(card.title),
			"移入提交元信息的待渲染正文没有失效");
		assert.equal(harness.getTranslation(pending) === null, true, "元信息区域不能注入迟到译文");
		assertCardLayout(harness, card);
	} finally {
		harness.dispose();
	}
});

// 验证 GitHub 提交规则只用于精确主机，类似域名和其他网站仍采用通用扫描。
test("GitHub commits 规则使用精确域名边界", async () => {
	for (const hostname of ["example.com", "gist.github.com", "github.com.evil.test"]) {
		const harness = createContentHarness({ contentFilters: ALL_FILTERS_DISABLED, translateText });
		try {
			harness.window.location.href = `https://${hostname}/objective-see/LuLu/commits/master/`;
			harness.root.innerHTML = fixture;
			const card = findCard(harness);
			harness.start();
			await waitFor(() => requestedTexts(harness).some((text) => text.includes("committed")),
				`${hostname} 的元信息被 GitHub 规则误排除`);
			const metadataRequest = requestedTexts(harness).find((text) => text.includes("committed"));
			assert.equal(metadataRequest.includes("objective-see"), true);
			assert.equal(metadataRequest.includes("f61db25"), true);
			await waitFor(() => harness.getTranslation(card.title), "其他站点的提交标题没有翻译");
			assert.equal(harness.getTranslation(card.title).parentElement === card.titleLink, true,
				"通用扫描仍应保留标题链接");
		} finally {
			harness.dispose();
		}
	}
});

function findCard(harness) {
	const row = harness.root.querySelector("[data-testid='commit-row-item']");
	const title = row.querySelector("h4");
	return {
		row,
		title,
		titleLink: title.querySelector("a"),
		attribution: row.querySelector("[class*='CommitAttribution-module__']"),
		metadata: row.querySelector("[class*='MetadataContainer-module__']"),
	};
}

function assertCardLayout(harness, card, expectedTranslation = TITLE_TRANSLATION) {
	assert.equal(card.row.querySelectorAll(":scope > .bt-translation").length, 0,
		"元信息译文不能作为额外网格子项落入左侧窄列");
	assert.equal(card.row.dataset.btSource, undefined, "整张提交卡片不应成为译文源块");
	for (const region of [card.attribution, card.metadata]) {
		assert.equal(Boolean(region.querySelector("[data-bt-source], .bt-translation")), false,
			"作者、时间、哈希和操作区域应保持原生结构");
	}
	const translation = harness.getTranslation(card.title);
	assert.ok(translation);
	assert.equal(translation.textContent, expectedTranslation);
	assert.equal(translation.parentElement === card.titleLink, true, "标题译文应属于原提交链接");
	assert.equal(card.titleLink.querySelectorAll(".bt-translation").length, 1);
	assert.equal(card.titleLink.getAttribute("href"), "/objective-see/LuLu/commit/f61db25c9c7f6bdc062baf51ea10da3a99998169");
}

function appendParagraph(harness, parent, text) {
	const paragraph = harness.document.createElement("p");
	paragraph.textContent = text;
	parent.append(paragraph);
	return paragraph;
}

function requestedTexts(harness) {
	return harness.translationRequests.flatMap(({ texts }) => texts);
}

function translateText(text) {
	return text === TITLE ? TITLE_TRANSLATION : `译文：${text}`;
}

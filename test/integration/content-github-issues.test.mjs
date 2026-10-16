import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const fixture = readFileSync(new URL("../fixtures/github-issues.html", import.meta.url), "utf8");
const TITLE = "Second instance does not exit when D-Bus name is taken, leaving duplicate daemons and duplicate notifications";
const TITLE_TRANSLATION = "当 D-Bus 名称被占用时第二个实例不会退出，导致重复的守护进程和通知";
const ALL_FILTERS_DISABLED = {
	skipShortLinks: false,
	skipSocialMetadata: false,
	skipTechnicalIdentifiers: false,
};

// 验证 Issues 的标题译文保留原链接，筛选栏和行内元信息不会生成额外网格项。
test("GitHub Issues 保持列表网格、筛选栏和标题链接", async () => {
	for (const contentFilters of [{}, ALL_FILTERS_DISABLED]) {
		const harness = createContentHarness({ contentFilters, translateText });
		try {
			harness.window.location.href = "https://github.com/flameshot-org/flameshot/issues";
			harness.root.innerHTML = fixture;
			const card = findCard(harness);
			const originalHeader = card.header.innerHTML;
			const originalDescription = card.description.innerHTML;
			const originalMetadata = card.metadata.innerHTML;
			const originalChildren = [...card.row.children];
			harness.start();
			await waitFor(() => harness.getTranslation(card.title), "Issue 标题没有翻译");

			assertCardLayout(harness, card);
			assert.equal(card.header.innerHTML, originalHeader, "筛选栏应保持原生结构");
			assert.equal(card.description.innerHTML, originalDescription);
			assert.equal(card.metadata.innerHTML, originalMetadata);
			assert.equal(harness.window.getComputedStyle(card.row).display, "grid");
			assert.deepEqual(requestedTexts(harness), [TITLE]);

			await harness.window.__bilingualWebTranslatorController.toggle();
			assert.equal(Boolean(card.surface.querySelector("[data-bt-source], [data-bt-owned]")), false);
			assert.equal(card.row.children.length, originalChildren.length);
			assert.equal(originalChildren.every((child, index) => card.row.children[index] === child), true,
				"关闭翻译应保留原网格子项及其顺序");
		} finally {
			harness.dispose();
		}
	}
});

// 验证动态加载、标签补齐和作者时间更新不会重建标题译文，标题变更仍正常翻译。
test("GitHub Issues 动态加载与元信息 hydration 保持翻译边界", async () => {
	const harness = createContentHarness({ contentFilters: ALL_FILTERS_DISABLED, translateText });
	try {
		harness.window.location.href = "https://github.com/flameshot-org/flameshot/issues";
		harness.start();
		harness.root.innerHTML = fixture;
		const card = findCard(harness);
		await waitFor(() => harness.getTranslation(card.title), "动态加载的 Issue 没有翻译");
		const initialTranslation = harness.getTranslation(card.title);
		card.description.querySelector("relative-time").textContent = "yesterday";
		card.description.querySelector("button").lastChild.textContent = "another-author";
		card.header.querySelector("[data-component='CounterLabel']").textContent = "672";
		card.badges.innerHTML = '<a href="/flameshot-org/flameshot/labels/bug"><span>Unconfirmed Bug</span></a>';
		const sentinel = appendParagraph(harness, harness.root, "Additional issues loaded after hydration.");
		await waitFor(() => harness.getTranslation(sentinel), "hydration 后扫描没有完成");
		assert.equal(harness.getTranslation(card.title) === initialTranslation, true,
			"元信息和标签更新不应重建标题译文");
		assertCardLayout(harness, card);
		assert.equal(card.badges.querySelector(".bt-translation") === null, true, "标签不能聚合成整行译文");
		assert.deepEqual(requestedTexts(harness).toSorted(), [TITLE, sentinel.firstChild.textContent].toSorted());

		const updatedTitle = "Prevent duplicate daemons when the D-Bus name is already taken";
		card.titleLink.querySelector("[data-component='Text']").textContent = updatedTitle;
		await waitFor(() => harness.getTranslation(card.title)?.textContent === `译文：${updatedTitle}`,
			"Issue 标题变更后译文没有更新");
		assertCardLayout(harness, card, `译文：${updatedTitle}`);
		assert.equal(harness.requestCount(TITLE), 1);
		assert.equal(harness.requestCount(updatedTitle), 1);
	} finally {
		harness.dispose();
	}
});

// 验证 GitHub 的排除规则局限于 Issues 列表组件，不影响普通正文、列表和筛选按钮。
test("GitHub Issues 规则不影响列表外的内容", async () => {
	const harness = createContentHarness({ contentFilters: ALL_FILTERS_DISABLED, translateText });
	try {
		harness.window.location.href = "https://github.com/flameshot-org/flameshot/issues";
		harness.root.innerHTML = fixture;
		const card = findCard(harness);
		const paragraph = appendParagraph(harness, card.surface, "An issue description outside the list remains readable.");
		const normalItem = harness.document.createElement("li");
		normalItem.innerHTML = '<div>A regular list note must remain translatable.</div>';
		card.row.parentElement.append(normalItem);
		const outsideButton = harness.document.createElement("button");
		outsideButton.dataset.testid = "authors-anchor-button";
		outsideButton.textContent = "Select an author";
		harness.root.append(outsideButton);
		harness.start();
		await waitFor(() => harness.getTranslation(card.title) && harness.getTranslation(paragraph) &&
			harness.getTranslation(normalItem) && harness.getTranslation(outsideButton), "列表外的正文或控件被误排除");
		assertCardLayout(harness, card);
		assert.equal(requestedTexts(harness).includes(paragraph.firstChild.textContent), true);
		assert.equal(requestedTexts(harness).includes(normalItem.firstChild.textContent), true);
		assert.equal(requestedTexts(harness).includes("Select an author"), true);
	} finally {
		harness.dispose();
	}
});

// 验证请求返回前移入元信息区域的正文会失效，迟到译文不能破坏网格或筛选栏。
test("GitHub Issues 渲染前重新检查排除边界", async () => {
	for (const destination of ["description", "header"]) {
		const deferred = Promise.withResolvers();
		const pendingText = "A pending note is moved into issue list controls.";
		const harness = createContentHarness({
			translateText: (text) => text === pendingText ? deferred.promise : translateText(text),
		});
		try {
			harness.window.location.href = "https://github.com/flameshot-org/flameshot/issues";
			harness.window.MutationObserver = class {
				observe() {}
				disconnect() {}
				takeRecords() { return []; }
			};
			harness.root.innerHTML = fixture;
			const card = findCard(harness);
			const pending = appendParagraph(harness, harness.root, pendingText);
			harness.start();
			await waitFor(() => harness.requestCount(pendingText) === 1, "待返回正文没有提交翻译");
			card[destination].append(pending);
			deferred.resolve(`译文：${pendingText}`);
			await waitFor(() => pending.dataset.btSource === undefined && harness.getTranslation(card.title),
				"移入排除区域的待渲染正文没有失效");
			assert.equal(harness.getTranslation(pending) === null, true, "排除区域不能注入迟到译文");
			assertCardLayout(harness, card);
		} finally {
			deferred.resolve(`译文：${pendingText}`);
			harness.dispose();
		}
	}
});

// 验证相同 DOM 在其他站点仍按通用规则翻译，不能把 GitHub 专用排除扩散到类似域名。
test("GitHub Issues 规则使用精确主机边界", async () => {
	for (const hostname of ["example.com", "gist.github.com", "github.com.evil.test"]) {
		const harness = createContentHarness({ contentFilters: ALL_FILTERS_DISABLED, translateText });
		try {
			harness.window.location.href = `https://${hostname}/flameshot-org/flameshot/issues`;
			harness.root.innerHTML = fixture;
			const card = findCard(harness);
			harness.start();
			await waitFor(() => harness.getTranslation(card.title) &&
				requestedTexts(harness).some((text) => text.includes("flameshot-org/flameshot#5001")) &&
				requestedTexts(harness).includes("Author"), `${hostname} 误用了 GitHub Issues 排除规则`);
			assert.equal(harness.getTranslation(card.title).parentElement === card.titleLink, true,
				"通用扫描仍应保留标题链接");
		} finally {
			harness.dispose();
		}
	}
});

function findCard(harness) {
	const surface = harness.root.querySelector("[data-testid='issues-list-surface']");
	const row = surface.querySelector("li[id*='-list-view-node-']");
	const title = row.querySelector("h3");
	return {
		surface,
		row,
		title,
		titleLink: title.querySelector("a"),
		badges: row.querySelector(".trailingBadgesContainer__4AEjpg"),
		header: surface.querySelector("[id$='-list-view-metadata']"),
		description: row.querySelector(".container__VGL_Vt"),
		metadata: row.querySelector(".metadataContainer__NZBoVo"),
	};
}

function assertCardLayout(harness, card, expectedTranslation = TITLE_TRANSLATION) {
	assert.equal(card.row.querySelectorAll(":scope > .bt-translation").length, 0,
		"Issue 元信息译文不能作为额外网格项落入左侧窄列");
	assert.equal(card.row.dataset.btSource, undefined, "整行 Issue 不应聚合为译文源块");
	for (const region of [card.header, card.description, card.metadata, card.badges]) {
		assert.equal(Boolean(region.querySelector("[data-bt-source], .bt-translation")), false,
			"筛选栏、作者、时间、标签和计数应保持原生结构");
	}
	const translation = harness.getTranslation(card.title);
	assert.ok(translation);
	assert.equal(translation.textContent, expectedTranslation);
	assert.equal(translation.parentElement === card.titleLink, true, "Issue 译文应属于原标题链接");
	assert.equal(card.titleLink.querySelectorAll(".bt-translation").length, 1);
	assert.equal(card.titleLink.href, "https://github.com/flameshot-org/flameshot/issues/5001");
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

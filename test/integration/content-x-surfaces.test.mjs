import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

// 验证 Explore 的非 tweetText 主内容恢复翻译，同时页面导航和动作控件保持排除。
test("X Explore 主内容使用稳定生成呈现", async () => {
	const headingText = "Today's News";
	const headlineText = "Vibe Coding Lets Anyone Build Apps with Plain Language AI Prompts";
	const summaryText = "A detailed Explore summary should remain bilingual after hover.";
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/explore";
		const navigation = createElement(harness.document, "nav", "Explore application navigation");
		const primary = createElement(harness.document, "section");
		const heading = createElement(harness.document, "h2", headingText);
		const card = createElement(harness.document, "article");
		card.setAttribute("role", "button");
		const headline = createElement(harness.document, "h3", headlineText);
		headline.style.display = "block";
		const summary = createElement(harness.document, "p", summaryText);
		const action = createElement(harness.document, "button", "Open detailed news actions");
		card.append(headline, summary);
		primary.append(heading, card, action);
		harness.root.append(navigation, primary);
		const sources = [heading, headline, summary, action];
		const sourceTexts = [headingText, headlineText, summaryText, action.textContent];
		const originalCardChildren = [...card.childNodes];

		harness.start();
		await waitFor(
			() => sources.every((source) => Boolean(source.dataset.btTranslation)),
			"X Explore 主内容没有全部生成译文",
		);

		for (const [source, text] of sources.map((source, index) => [source, sourceTexts[index]])) {
			assertGeneratedTranslation(harness, source, `译文：${text}`);
			assert.equal(harness.requestCount(text), 1);
		}
		assert.equal(harness.requestCount(navigation.textContent), 0);
		assert.equal(navigation.dataset.btSource, undefined);
		assert.equal(primary.querySelector(".bt-translation[data-bt-owned='true']"), null);

		const descriptionIds = sources.map((source) => source.dataset.btDescriptionId);
		const childListMutations = [];
		const observer = new harness.window.MutationObserver((records) => {
			childListMutations.push(...records.filter(({ type }) => type === "childList"));
		});
		observer.observe(primary, { childList: true, subtree: true });
		for (let index = 0; index < 80; index += 1) {
			card.className = index % 2 === 0 ? "is-hovered" : "is-visible";
			card.style.display = index % 2 === 0 ? "block" : "flex";
			card.style.flexDirection = "column";
			card.dispatchEvent(new harness.window.Event("pointerover", { bubbles: true }));
			card.dispatchEvent(new harness.window.Event("pointerout", { bubbles: true }));
			removeUnknownChildren(card, originalCardChildren);
		}
		await new Promise((resolve) => setTimeout(resolve, 650));
		observer.disconnect();

		assert.deepEqual(
			sources.map((source) => source.dataset.btDescriptionId),
			descriptionIds,
		);
		assert.equal(childListMutations.length, 0);
		assertOriginalNodes(card, originalCardChildren);
		for (const [source, text] of sources.map((source, index) => [source, sourceTexts[index]])) {
			assert.equal(harness.requestCount(text), 1);
			assert.equal(source.dataset.btTranslation, `译文：${text}`);
		}

		const dynamicText = "A dynamically loaded Explore headline must also be translated.";
		const dynamicHeadline = createElement(harness.document, "p", dynamicText);
		primary.append(dynamicHeadline);
		await waitFor(
			() => dynamicHeadline.dataset.btTranslation === `译文：${dynamicText}`,
			"动态 Explore 主内容没有使用稳定生成呈现",
		);
		assert.equal(harness.requestCount(dynamicText), 1);
		assert.equal(primary.querySelector(".bt-translation[data-bt-owned='true']"), null);
	} finally {
		harness.dispose();
	}
});

// 验证长帖 Show more 控件反复 hover、脱离和重挂时，不会让正文译文消失或重建。
test("X 长帖 Show more hover 不改变译文呈现", async () => {
	const sourceText = "A long post keeps its translated surface while Show more is hovered.";
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		const article = createElement(harness.document, "article");
		article.dataset.testid = "tweet";
		const tweetText = createElement(harness.document, "div");
		tweetText.dataset.testid = "tweetText";
		const text = createElement(harness.document, "span", sourceText);
		const showMore = createElement(harness.document, "button", "Show more");
		showMore.dataset.testid = "tweet-text-show-more-link";
		const contentWrapper = createElement(harness.document, "div");
		contentWrapper.append(text, showMore);
		tweetText.append(contentWrapper);
		article.append(tweetText);
		harness.root.append(article);
		const originalChildren = [...tweetText.childNodes];
		const originalWrapperChildren = [...contentWrapper.childNodes];

		harness.start();
		await waitFor(
			() => Boolean(tweetText.dataset.btTranslation),
			"带 Show more 的 X 长帖没有生成译文",
		);
		const initialTranslation = tweetText.dataset.btTranslation;
		const initialDescriptionId = tweetText.dataset.btDescriptionId;
		const heightTrace = [];
		const extensionChildMutations = [];
		const observer = new harness.window.MutationObserver((records) => {
			for (const record of records) {
				extensionChildMutations.push(...findOwnedNodes(record));
			}
		});
		observer.observe(tweetText, { childList: true, subtree: true });

		tweetText.style.display = "none";
		await new Promise((resolve) => setTimeout(resolve, 320));
		assert.equal(tweetText.dataset.btTranslation, initialTranslation);
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);
		tweetText.style.display = "block";
		await new Promise((resolve) => setTimeout(resolve, 320));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);
		article.hidden = true;
		await new Promise((resolve) => setTimeout(resolve, 220));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);
		article.hidden = false;
		article.setAttribute("role", "button");
		await new Promise((resolve) => setTimeout(resolve, 220));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);
		article.removeAttribute("role");

		tweetText.hidden = true;
		tweetText.hidden = false;
		tweetText.setAttribute("role", "button");
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);

		showMore.hidden = true;
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);
		showMore.hidden = false;
		showMore.setAttribute("role", "button");
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);

		delete tweetText.dataset.btTranslation;
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(tweetText.dataset.btTranslation, initialTranslation);
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);

		contentWrapper.remove();
		await new Promise((resolve) => setTimeout(resolve, 30));
		heightTrace.push(simulatedTweetHeight(tweetText));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);
		tweetText.append(contentWrapper);
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);

		article.remove();
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);
		assert.equal(tweetText.dataset.btTranslation, initialTranslation);
		harness.root.append(article);
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);

		for (let index = 0; index < 80; index += 1) {
			showMore.className = index % 2 === 0 ? "is-hovered" : "is-visible";
			showMore.style.display = index % 2 === 0 ? "inline" : "inline-flex";
			showMore.dispatchEvent(new harness.window.Event("pointerover", { bubbles: true }));
			showMore.dispatchEvent(new harness.window.Event("pointerout", { bubbles: true }));
			if (index % 8 === 0) {
				showMore.remove();
				heightTrace.push(simulatedTweetHeight(tweetText));
				contentWrapper.append(showMore);
			}
			heightTrace.push(simulatedTweetHeight(tweetText));
		}
		await new Promise((resolve) => setTimeout(resolve, 650));
		observer.disconnect();
		heightTrace.push(simulatedTweetHeight(tweetText));

		assert.equal(tweetText.dataset.btTranslation, initialTranslation);
		assert.equal(tweetText.dataset.btDescriptionId, initialDescriptionId);
		assert.equal(harness.document.getElementById(initialDescriptionId)?.textContent, initialTranslation);
		assert.equal(harness.requestCount(sourceText), 1);
		assert.equal(harness.requestCount("Show more"), 0);
		assert.deepEqual(new Set(heightTrace), new Set([84]));
		assert.deepEqual(extensionChildMutations, []);
		assertOriginalNodes(tweetText, originalChildren);
		assertOriginalNodes(contentWrapper, originalWrapperChildren);
		assert.equal(article.querySelector(".bt-translation[data-bt-owned='true']"), null);

		article.remove();
		await new Promise((resolve) => setTimeout(resolve, 30));
		harness.injectAgain();
		await waitFor(
			() => harness.messages.some(({ type }) => type === "CANCEL_RUN"),
			"宽限期内停止运行没有取消 X 翻译任务",
		);
		harness.root.append(article);
		assert.equal(tweetText.dataset.btTranslation, undefined);
		assert.equal(tweetText.dataset.btDescriptionId, undefined);
		assert.equal(harness.document.getElementById(initialDescriptionId), null);
	} finally {
		harness.dispose();
	}
});

// 验证扩展重载会声明式清理旧上下文留下的 generated 属性、描述节点和 aria 引用。
test("X 新运行清理跨上下文遗留的生成译文", async () => {
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		const source = createElement(harness.document, "div", "这是一条无需翻译的中文帖子。");
		source.dataset.testid = "tweetText";
		source.dataset.btSource = "old-run";
		source.dataset.btPresentation = "generated";
		source.dataset.btPresentationRun = "old-run";
		source.dataset.btTranslation = "过期译文";
		source.dataset.btTranslationLang = "zh-CN";
		source.dataset.btDescriptionId = "old-description";
		source.setAttribute("aria-describedby", "host-description old-description");
		const hostData = createElement(harness.document, "div", "宿主自己的 data 属性");
		hostData.dataset.btTranslation = "host-owned";
		hostData.dataset.btDescriptionId = "host-data-description";
		hostData.setAttribute("aria-describedby", "host-data-description");
		const hostDescription = createElement(harness.document, "span", "宿主说明");
		hostDescription.id = "host-description";
		const staleDescription = createElement(harness.document, "span", "过期译文");
		staleDescription.id = "old-description";
		staleDescription.className = "bt-translation bt-translation-description";
		staleDescription.dataset.btOwned = "true";
		staleDescription.dataset.btRun = "old-run";
		harness.root.append(source, hostData, hostDescription);
		harness.document.body.append(staleDescription);

		harness.start();
		await waitFor(
			() => harness.document.getElementById("old-description") === null,
			"新运行没有清理旧 generated 描述节点",
		);
		assert.equal(source.dataset.btSource, undefined);
		assert.equal(source.dataset.btPresentation, undefined);
		assert.equal(source.dataset.btPresentationRun, undefined);
		assert.equal(source.dataset.btTranslation, undefined);
		assert.equal(source.dataset.btTranslationLang, undefined);
		assert.equal(source.dataset.btDescriptionId, undefined);
		assert.equal(source.getAttribute("aria-describedby"), "host-description");
		assert.equal(hostData.dataset.btTranslation, "host-owned");
		assert.equal(hostData.dataset.btDescriptionId, "host-data-description");
		assert.equal(hostData.getAttribute("aria-describedby"), "host-data-description");
		assert.equal(harness.requestCount(source.textContent), 0);
	} finally {
		harness.dispose();
	}
});

function createElement(document, tagName, text = "") {
	const element = document.createElement(tagName);
	element.textContent = text;
	return element;
}
function assertGeneratedTranslation(harness, source, expectedText) {
	assert.equal(source.dataset.btPresentation, "generated");
	assert.equal(source.dataset.btTranslation, expectedText);
	assert.equal(harness.getTranslation(source), null);
	const description = harness.document.getElementById(source.dataset.btDescriptionId);
	assert.equal(description?.textContent, expectedText);
}
function assertOriginalNodes(parent, originalNodes) {
	assert.equal(parent.childNodes.length, originalNodes.length);
	for (const [index, node] of originalNodes.entries()) {
		assert.equal(parent.childNodes[index], node);
	}
}
function removeUnknownChildren(parent, originalNodes) {
	const knownNodes = new Set(originalNodes);
	for (const node of [...parent.childNodes]) {
		if (!knownNodes.has(node)) {
			node.remove();
		}
	}
}

function findOwnedNodes(record) {
	const nodes = [...record.addedNodes, ...record.removedNodes];
	return nodes.filter((node) => node.matches?.("[data-bt-owned='true']"));
}

function simulatedTweetHeight(tweetText) {
	return 48 + (tweetText.dataset.btTranslation ? 36 : 0);
}

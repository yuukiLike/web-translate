import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";
import {
	assertGeneratedTranslation,
	assertHostNodes,
	assertSelectableTranslation,
	getGeneratedTranslation,
} from "../helpers/generated-translation-assertions.mjs";

// 验证 X 的 hover mutation、宿主清理与虚拟行复用不会改变帖子原始内容或重建可选择译文。
test("X hover 保持帖子原始 DOM 与译文呈现稳定", async () => {
	const sourceText = "Keep the translated post stable while the pointer moves.";
	const updatedText = "A recycled X row now contains different post text.";
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		const navigation = harness.document.createElement("nav");
		navigation.textContent = "Explore current conversations";
		const tweet = createTweet(harness.document, sourceText);
		const hostDescription = harness.document.createElement("span");
		hostDescription.id = "host-tweet-description";
		hostDescription.textContent = "Host-provided tweet context";
		tweet.text.setAttribute("aria-describedby", hostDescription.id);
		tweet.article.append(hostDescription);
		harness.root.append(navigation, tweet.article);
		const originalTweetChildren = [...tweet.text.childNodes];
		const originalArticleChildren = [...tweet.article.childNodes];
		const simulatedHeights = [];

		harness.start();
		await waitFor(
			() =>
				Boolean(tweet.text.dataset.btTranslation) ||
				Boolean(harness.getTranslation(tweet.text)),
			"X 帖子没有生成可检查的译文",
		);

		const initialTranslation = tweet.text.dataset.btTranslation;
		assert.equal(initialTranslation, `译文：${sourceText}`);
		assert.equal(tweet.text.dataset.btPresentation, "generated");
		assert.equal(tweet.text.dataset.btTranslationLang, "zh-CN");
		const initialTranslationNode = assertGeneratedTranslation(
			tweet.text,
			initialTranslation,
		);
		const initialTranslationId = initialTranslationNode.id;
		assertSelectableTranslation(
			harness.window,
			initialTranslationNode,
			initialTranslation,
		);
		assert.equal(tweet.text.getAttribute("aria-describedby"), hostDescription.id);
		assertHostNodes(tweet.text, originalTweetChildren, initialTranslationNode);
		assertHostNodes(tweet.article, originalArticleChildren);
		assert.equal(harness.getTranslation(tweet.text), initialTranslationNode);
		assert.equal(harness.requestCount(sourceText), 1);
		assert.equal(harness.requestCount(navigation.textContent), 0);
		assert.equal(harness.requestCount(tweet.author.textContent), 0);
		assert.equal(harness.requestCount(tweet.actions.textContent), 0);
		simulatedHeights.push(getSimulatedTweetHeight(tweet.article));

		for (let index = 0; index < 80; index += 1) {
			const textNode = tweet.text.firstElementChild;
			textNode.className = index % 2 === 0 ? "is-hovered" : "is-visible";
			textNode.style.opacity = index % 3 === 0 ? "0.99" : "1";
			textNode.dispatchEvent(new harness.window.Event("pointerover", { bubbles: true }));
			textNode.dispatchEvent(new harness.window.Event("pointerout", { bubbles: true }));
			if (index % 10 === 0) {
				removeUnknownChildren(tweet.article, originalArticleChildren);
				simulatedHeights.push(getSimulatedTweetHeight(tweet.article));
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 600));
		simulatedHeights.push(getSimulatedTweetHeight(tweet.article));

		assert.equal(tweet.text.dataset.btTranslation, initialTranslation);
		assert.equal(tweet.text.dataset.btDescriptionId, initialTranslationId);
		assert.equal(tweet.text.getAttribute("aria-describedby"), hostDescription.id);
		assertHostNodes(tweet.text, originalTweetChildren, initialTranslationNode);
		assertHostNodes(tweet.article, originalArticleChildren);
		assert.equal(harness.getTranslation(tweet.text), initialTranslationNode);
		assert.equal(harness.requestCount(sourceText), 1);
		assert.deepEqual(new Set(simulatedHeights), new Set([84]));

		const initialTextNode = initialTranslationNode.firstChild;
		initialTranslationNode.remove();
		await waitFor(
			() => tweet.text.lastChild === initialTranslationNode,
			"X 删除真实译文后没有复挂同一个节点",
		);
		assert.equal(initialTranslationNode.firstChild, initialTextNode);
		assertHostNodes(tweet.text, originalTweetChildren, initialTranslationNode);
		assert.equal(harness.requestCount(sourceText), 1);

		tweet.text.firstElementChild.textContent = updatedText;
		await waitFor(
			() => tweet.text.dataset.btTranslation === `译文：${updatedText}`,
			"X 虚拟行复用后没有更新生成译文",
		);
		const updatedTranslationNode = assertGeneratedTranslation(
			tweet.text,
			`译文：${updatedText}`,
		);
		const updatedTranslationId = updatedTranslationNode.id;
		assert.notEqual(updatedTranslationId, initialTranslationId);
		assert.equal(harness.document.getElementById(initialTranslationId), null);
		assert.equal(tweet.text.getAttribute("aria-describedby"), hostDescription.id);
		assert.notEqual(updatedTranslationNode, initialTranslationNode);
		assertSelectableTranslation(
			harness.window,
			updatedTranslationNode,
			`译文：${updatedText}`,
		);
		assertHostNodes(tweet.text, originalTweetChildren, updatedTranslationNode);
		assertHostNodes(tweet.article, originalArticleChildren);
		assert.equal(harness.requestCount(updatedText), 1);

		const dynamicText = "A dynamically loaded X post should use the same stable surface.";
		const dynamicTweet = createTweet(harness.document, dynamicText);
		const dynamicOriginalChildren = [...dynamicTweet.text.childNodes];
		harness.root.append(dynamicTweet.article);
		await waitFor(
			() => dynamicTweet.text.dataset.btTranslation === `译文：${dynamicText}`,
			"动态加载的 X 帖子没有使用生成呈现",
		);
		const dynamicTranslationNode = assertGeneratedTranslation(
			dynamicTweet.text,
			`译文：${dynamicText}`,
		);
		assertSelectableTranslation(
			harness.window,
			dynamicTranslationNode,
			`译文：${dynamicText}`,
		);
		assert.equal(harness.requestCount(dynamicText), 1);
		assertHostNodes(dynamicTweet.text, dynamicOriginalChildren, dynamicTranslationNode);

		harness.injectAgain();
		await waitFor(
			() => harness.messages.some(({ type }) => type === "CANCEL_RUN"),
			"停止运行没有取消 X 翻译任务",
		);
		assert.equal(tweet.text.dataset.btPresentation, undefined);
		assert.equal(tweet.text.dataset.btPresentationRun, undefined);
		assert.equal(tweet.text.dataset.btTranslation, undefined);
		assert.equal(tweet.text.dataset.btTranslationLang, undefined);
		assert.equal(tweet.text.dataset.btDescriptionId, undefined);
		assert.equal(tweet.text.dataset.btSource, undefined);
		assert.equal(tweet.text.getAttribute("aria-describedby"), hostDescription.id);
		assert.equal(harness.document.getElementById(updatedTranslationId), null);
		assert.equal(dynamicTweet.text.dataset.btPresentation, undefined);
		assert.equal(dynamicTweet.text.dataset.btTranslation, undefined);
		assert.equal(dynamicTweet.text.dataset.btSource, undefined);
		assert.equal(
			harness.document.querySelector(".bt-translation-description[data-bt-owned='true']"),
			null,
		);
		assert.equal(
			harness.document.querySelector(".bt-translation-generated[data-bt-owned='true']"),
			null,
		);
		assertHostNodes(tweet.text, originalTweetChildren);
		assertHostNodes(tweet.article, originalArticleChildren);
	} finally {
		harness.dispose();
	}
});

// 验证 X 稳定呈现仅应用于明确允许的产品域名，不影响帮助站和相似域名的普通网页渲染。
test("X 站点策略只作用于精确的应用域名", async () => {
	for (const url of ["https://x.com/home", "https://twitter.com/home"]) {
		const harness = createContentHarness();
		try {
			harness.window.location.href = url;
			const tweet = createTweet(harness.document, "Translate only this post body.");
			harness.root.append(tweet.article);
			harness.start();
			await waitFor(
				() => Boolean(tweet.text.dataset.btTranslation),
				`${url} 没有使用 X 稳定呈现策略`,
			);
			const translation = harness.getTranslation(tweet.text);
			assert.equal(translation?.parentElement, tweet.text);
			assert.equal(translation?.classList.contains("bt-translation-generated"), true);
		} finally {
			harness.dispose();
		}
	}

	for (const url of ["https://help.x.com/article", "https://evilx.com/article"]) {
		const harness = createContentHarness();
		try {
			harness.window.location.href = url;
			const tweet = createTweet(harness.document, "Use normal rendering outside X apps.");
			harness.root.append(tweet.article);
			harness.start();
			await waitFor(
				() => Boolean(harness.getTranslation(tweet.text)),
				`${url} 被错误纳入 X 应用策略`,
			);
			assert.equal(tweet.text.dataset.btPresentation, undefined);
		} finally {
			harness.dispose();
		}
	}
});

// 验证服务原样返回 X 帖子时只完成记录，不创建生成属性或真实译文节点。
test("原文与译文相同时不创建 X 生成呈现", async () => {
	const sourceText = "This unchanged API sentence should not be displayed twice.";
	const harness = createContentHarness({
		contentFilters: { skipTechnicalIdentifiers: false },
		translateText: async (text) => text,
	});
	try {
		harness.window.location.href = "https://x.com/home";
		const tweet = createTweet(harness.document, sourceText);
		harness.root.append(tweet.article);
		harness.start();
		await waitFor(
			() => harness.statusText().startsWith("双语翻译完成"),
			"相同译文没有完成收敛",
		);
		assert.equal(harness.requestCount(sourceText), 1);
		assert.equal(tweet.text.dataset.btPresentation, undefined);
		assert.equal(tweet.text.dataset.btTranslation, undefined);
		assert.equal(harness.getTranslation(tweet.text), null);
		assert.equal(
			harness.document.querySelector(".bt-translation-description[data-bt-owned='true']"),
			null,
		);
	} finally {
		harness.dispose();
	}
});

// 验证相同译文去重也覆盖通用网页，防止不可译术语产生重复的块级 DOM。
test("普通网页的相同译文也不会重复插入 DOM", async () => {
	const sourceText = "An unchanged translation should not duplicate this paragraph.";
	const harness = createContentHarness({ translateText: async (text) => text });
	try {
		const { source } = harness.addArticle(sourceText);
		harness.start();
		await waitFor(
			() => harness.statusText().startsWith("双语翻译完成"),
			"普通网页的相同译文没有完成收敛",
		);
		assert.equal(harness.requestCount(sourceText), 1);
		assert.equal(harness.getTranslation(source), null);
		assert.equal(source.textContent, sourceText);
	} finally {
		harness.dispose();
	}
});

function createTweet(document, text) {
	const article = document.createElement("article");
	article.dataset.testid = "tweet";
	const author = document.createElement("div");
	author.dataset.testid = "User-Name";
	author.textContent = "Stable Post Author";
	const tweetText = document.createElement("div");
	tweetText.dataset.testid = "tweetText";
	const textSpan = document.createElement("span");
	textSpan.textContent = text;
	tweetText.append(textSpan);
	const actions = document.createElement("div");
	actions.setAttribute("role", "group");
	actions.textContent = "Open detailed post analytics";
	article.append(author, tweetText, actions);
	return { actions, article, author, text: tweetText };
}

function removeUnknownChildren(parent, originalNodes) {
	const knownNodes = new Set(originalNodes);
	for (const node of [...parent.childNodes]) {
		if (!knownNodes.has(node)) {
			node.remove();
		}
	}
}

function getSimulatedTweetHeight(article) {
	const source = article.querySelector("[data-testid='tweetText']");
	const hasGeneratedTranslation = Boolean(source?.dataset.btTranslation);
	const hasDomTranslation = Boolean(
		article.querySelector(".bt-translation[data-bt-owned='true']"),
	);
	return 48 + (hasGeneratedTranslation || hasDomTranslation ? 36 : 0);
}

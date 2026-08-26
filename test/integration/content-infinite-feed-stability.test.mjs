import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const ARTICLE_COUNT = 12;
const VISIBLE_ARTICLE_COUNT = 3;

// 验证移除最旧正文并在列表末尾追加全新正文时，每篇文章都保持独立且会及时翻译。
test("有界无限滚动不会被识别为同槽轮播", async () => {
	const harness = createContentHarness();
	try {
		const feed = harness.document.createElement("section");
		const visible = [];
		for (let index = 1; index <= VISIBLE_ARTICLE_COUNT; index += 1) {
			visible.push(createArticle(harness.document, index));
		}
		feed.append(...visible);
		harness.root.append(feed);
		harness.start();
		await waitFor(
			() => visible.every((article) => Boolean(harness.getTranslation(article))),
			"初始 feed 正文没有全部完成翻译",
		);

		for (let index = VISIBLE_ARTICLE_COUNT + 1; index <= ARTICLE_COUNT; index += 1) {
			visible.shift().remove();
			const article = createArticle(harness.document, index);
			visible.push(article);
			feed.append(article);
			await waitFor(
				() => harness.getTranslation(article)?.textContent === `译文：${article.textContent}`,
				`第 ${index} 篇稳定 feed 正文被错误跳过`,
			);
		}

		for (let index = 1; index <= ARTICLE_COUNT; index += 1) {
			assert.equal(harness.requestCount(articleText(index)), 1);
		}
		await waitFor(
			() =>
				harness.statusText() ===
				`双语翻译完成，已覆盖 ${ARTICLE_COUNT} 个文本块`,
			"无限 feed 的最终进度没有进入完成状态",
		);
	} finally {
		harness.dispose();
	}
});

// 验证单条多增多删记录的 fresh 整窗滑动不会让 head/tail 余项循环继承易变身份。
test("fresh 整窗滑动长期保持可翻译", async () => {
	const harness = createContentHarness();
	try {
		const feed = harness.document.createElement("section");
		let visible = Array.from({ length: VISIBLE_ARTICLE_COUNT }, (_, index) =>
			createArticle(harness.document, index + 1),
		);
		feed.append(...visible);
		harness.root.append(feed);
		harness.start();
		await waitFor(
			() => visible.every((article) => Boolean(harness.getTranslation(article))),
			"整窗滑动前的正文没有全部完成翻译",
		);

		for (
			let start = 2;
			start <= ARTICLE_COUNT - VISIBLE_ARTICLE_COUNT + 1;
			start += 1
		) {
			visible = Array.from({ length: VISIBLE_ARTICLE_COUNT }, (_, offset) =>
				createArticle(harness.document, start + offset),
			);
			feed.replaceChildren(...visible);
			await delay(20);
		}

		await waitFor(
			() => visible.every((article) => Boolean(harness.getTranslation(article))),
			"长期整窗滑动后的稳定正文被错误跳过",
		);
		await waitFor(
			() => harness.statusText() === "双语翻译完成，已覆盖 6 个文本块",
			"长期整窗滑动后的翻译任务没有完成收尾",
		);
		for (const article of visible) {
			assert.equal(harness.requestCount(article.textContent), 1);
		}
	} finally {
		harness.dispose();
	}
});

function createArticle(document, index) {
	const article = document.createElement("p");
	article.textContent = articleText(index);
	return article;
}

function articleText(index) {
	return `Stable feed article ${index} contains ordinary readable prose.`;
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

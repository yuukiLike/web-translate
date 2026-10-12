import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";
import { assertGeneratedTranslation } from "../helpers/generated-translation-assertions.mjs";

// 请求时可见不代表返回时仍可见；部分越过顶部的整行也不能被译文增高。
test("X 迟到译文等待回滚，并从缓存恢复一次呈现", async () => {
	const response = Promise.withResolvers();
	const text = "An earlier post must not push down the current reading position.";
	const harness = createContentHarness({ translateText: async () => response.promise, translateDynamicContent: false });
	let top = 100;
	try {
		harness.window.location.href = "https://x.com/home";
		const { source, row } = addTweet(harness, text, () => top);
		harness.start();
		await waitFor(() => harness.requestCount(text) === 1);
		top = -20; // 正文仍在屏幕内，但整行开头已经越过顶部。
		scroll(harness);
		response.resolve("较早帖子的迟到译文");
		await waitFor(() => harness.statusText() === "滚动到正文后继续翻译");
		assert.equal(source.dataset.btTranslation, undefined);
		assert.equal(row.querySelectorAll(".bt-translation").length, 0);
		assert.equal(source.dataset.btLoading, undefined);
		assert.equal(source.dataset.btReadingLayout, undefined);

		top = 100;
		scroll(harness);
		await waitFor(() => source.dataset.btTranslation === "较早帖子的迟到译文");
		const translation = assertGeneratedTranslation(source, "较早帖子的迟到译文");
		await waitFor(() => harness.statusText() === "已覆盖 1 个文本块");
		assert.equal(harness.requestCount(text), 1, "回滚应复用已返回的缓存");
		top = -300;
		scroll(harness);
		await new Promise((resolve) => setTimeout(resolve, 350));
		assert.equal(translation.isConnected, true, "滚出视口不能删除已显示译文");
	} finally {
		response.resolve("较早帖子的迟到译文");
		harness.dispose();
	}
});

// 上方和远处正文不抢占首屏请求，下方半屏可预取；回滚重新检查当前原文。
test("X 按附近正文调度，回滚时使用最新原文", async () => {
	const harness = createContentHarness({ translateDynamicContent: false });
	let aboveTop = -250;
	let farTop = 1300;
	try {
		harness.window.location.href = "https://x.com/home";
		const above = addTweet(harness, "The original post above the viewport.", () => aboveTop);
		const visible = addTweet(harness, "The post currently being read.", () => 100);
		const nearby = addTweet(harness, "The next post just below the viewport.", () => 950);
		const far = addTweet(harness, "A distant post should wait for scrolling.", () => farTop);
		harness.start();
		await waitFor(() => harness.statusText() === "已覆盖 2 个文本块，滚动后继续");
		assertGeneratedTranslation(visible.source, `译文：${visible.text}`);
		assertGeneratedTranslation(nearby.source, `译文：${nearby.text}`);
		assert.equal(harness.requestCount(above.text), 0);
		assert.equal(harness.requestCount(far.text), 0);

		above.source.textContent = "A recycled row now contains a different post.";
		aboveTop = 100;
		farTop = 900;
		scroll(harness);
		await waitFor(() => Boolean(above.source.dataset.btTranslation && far.source.dataset.btTranslation));
		assertGeneratedTranslation(above.source, "译文：A recycled row now contains a different post.");
		assert.equal(harness.requestCount(above.text), 0, "回滚不得发送已被宿主替换的原文");
		assert.equal(harness.requestCount(far.text), 1);
	} finally {
		harness.dispose();
	}
});

test("X 延后的旧结果不能写入已换文的虚拟行", async () => {
	const response = Promise.withResolvers();
	const oldText = "An old post waiting for its translation.";
	const newText = "A different post now occupies this recycled row.";
	const harness = createContentHarness({
		translateDynamicContent: false,
		translateText: async (text) => text === oldText ? response.promise : "新帖译文",
	});
	let top = 100;
	try {
		harness.window.location.href = "https://x.com/home";
		const { source } = addTweet(harness, oldText, () => top);
		harness.start();
		await waitFor(() => harness.requestCount(oldText) === 1);
		top = -300;
		response.resolve("旧帖译文");
		await waitFor(() => harness.statusText() === "滚动到正文后继续翻译");
		source.textContent = newText;
		top = 100;
		scroll(harness);
		await waitFor(() => source.dataset.btTranslation === "新帖译文");
		assert.equal(harness.requestCount(newText), 1);
		assertGeneratedTranslation(source, "新帖译文");
	} finally {
		response.resolve("旧帖译文");
		harness.dispose();
	}
});

// 第一波请求未返回前继续滚动，后续已排队段落也应停止发送，不能只检查首次扫描。
test("X 在发送下一批前重新检查视口范围", async () => {
	const response = Promise.withResolvers();
	const harness = createContentHarness({
		translateDynamicContent: false,
		translateText: async (text, { requestNumber }) => {
			if (requestNumber <= 2) await response.promise;
			return `译文：${text}`;
		},
	});
	const positions = Array(32).fill(100);
	try {
		harness.window.location.href = "https://x.com/home";
		const tweets = positions.map((_, index) => addTweet(harness,
			`Post number ${index} remains independently translatable.`, () => positions[index]));
		harness.start();
		await waitFor(() => harness.translationRequests.length === 2);
		positions[30] = -250;
		positions[31] = -250;
		scroll(harness);
		response.resolve();
		await waitFor(() => harness.statusText() === "已覆盖 30 个文本块，滚动后继续");
		assert.equal(harness.translationRequests.length, 2);
		assert.equal(harness.requestCount(tweets[30].text), 0);
		assert.equal(harness.requestCount(tweets[31].text), 0);
		positions[30] = 100;
		positions[31] = 400;
		scroll(harness);
		await waitFor(() => harness.statusText() === "已覆盖 32 个文本块");
		assert.equal(harness.requestCount(tweets[30].text), 1);
		assert.equal(harness.requestCount(tweets[31].text), 1);
	} finally {
		response.resolve();
		harness.dispose();
	}
});

// Pro 列/弹层使用自己的滚动边界，窗口内可见不代表未越过内部视口顶部。
test("X 内部滚动容器使用局部顶部判断迟到结果", async () => {
	const response = Promise.withResolvers();
	const harness = createContentHarness({ translateText: async () => response.promise, translateDynamicContent: false });
	let top = 300;
	try {
		harness.window.location.href = "https://pro.x.com/";
		const scroller = harness.document.createElement("section");
		scroller.style.overflowY = "auto";
		setRectangle(scroller, () => 200, 400);
		for (const [key, value] of Object.entries({ clientHeight: 400, scrollHeight: 2000, clientWidth: 600 })) {
			Object.defineProperty(scroller, key, { configurable: true, value });
		}
		harness.root.append(scroller);
		const tweet = addTweet(harness, "A post inside an independently scrolling column.", () => top);
		scroller.append(tweet.row);
		harness.start();
		await waitFor(() => harness.requestCount(tweet.text) === 1);
		top = 180;
		scroll(harness, scroller);
		response.resolve("独立滚动列中的译文");
		await waitFor(() => harness.statusText() === "滚动到正文后继续翻译");
		assert.equal(tweet.source.dataset.btTranslation, undefined);
		top = 300;
		scroll(harness, scroller);
		await waitFor(() => tweet.source.dataset.btTranslation === "独立滚动列中的译文");
		assert.equal(harness.requestCount(tweet.text), 1);
	} finally {
		response.resolve("独立滚动列中的译文");
		harness.dispose();
	}
});

// 等待回滚的引用不得在移除或停用后重建；没有 DOM 监听时也需正确清理。
test("X 延后正文在移除或停止后不恢复", async () => {
	const response = Promise.withResolvers();
	const harness = createContentHarness({ translateText: async () => response.promise, translateDynamicContent: false });
	let top = 100;
	try {
		harness.window.location.href = "https://x.com/home";
		const removed = addTweet(harness, "A detached post cannot regain a translation.", () => top);
		const stopped = addTweet(harness, "A stopped translation must remain stopped.", () => top);
		harness.start();
		await waitFor(() => harness.requestCount(stopped.text) === 1);
		top = -300;
		response.resolve("延后结果");
		await waitFor(() => harness.statusText() === "滚动到正文后继续翻译");
		scroll(harness); // 留下待处理定时器，停止时也必须清理。
		removed.row.remove();
		await harness.window.__bilingualWebTranslatorController.toggle();
		top = 100;
		scroll(harness);
		await new Promise((resolve) => setTimeout(resolve, 350));
		assert.equal(removed.source.dataset.btTranslation, undefined);
		assert.equal(stopped.source.dataset.btTranslation, undefined);
		assert.equal(harness.document.querySelectorAll(".bt-translation").length, 0);
	} finally {
		response.resolve("延后结果");
		harness.dispose();
	}
});

// X 的取舍不能改变普通文章或相似域名的整页翻译。
test("普通网页继续翻译视口上下方的正文", async () => {
	for (const hostname of ["example.com", "help.x.com", "x.com.evil.test"]) {
		const harness = createContentHarness();
		try {
			harness.window.location.href = `https://${hostname}/article`;
			const above = addTweet(harness, "An earlier paragraph on a regular page.", () => -1000);
			const below = addTweet(harness, "A distant paragraph on a regular page.", () => 5000);
			harness.start();
			await waitFor(() => Boolean(harness.getTranslation(above.source) && harness.getTranslation(below.source)));
			assert.equal(harness.requestCount(above.text), 1);
			assert.equal(harness.requestCount(below.text), 1);
		} finally {
			harness.dispose();
		}
	}
});

function addTweet(harness, text, getTop) {
	const { article, source } = harness.addArticle(text, { lang: "en" });
	article.dataset.testid = "tweet";
	source.dataset.testid = "tweetText";
	const row = harness.document.createElement("div");
	row.dataset.testid = "cellInnerDiv";
	row.append(article);
	harness.root.append(row);
	setRectangle(row, getTop, 200);
	setRectangle(source, () => getTop() + 40, 100);
	return { source, row, text };
}

function setRectangle(element, getTop, height) {
	element.getBoundingClientRect = () => ({
		top: getTop(), bottom: getTop() + height, left: 0, right: 600, width: 600, height,
	});
}

function scroll(harness, target = harness.window) {
	target.dispatchEvent(new harness.window.Event("scroll"));
}

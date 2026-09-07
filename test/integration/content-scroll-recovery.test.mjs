import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

function rectangle(top, laidOut = true) {
	return { top, bottom: top + 60, left: 0, right: 600,
		width: laidOut ? 600 : 0, height: laidOut ? 60 : 0 };
}

function setRectangle(source, measure) {
	Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: measure });
}

function mountArticle(harness, count = 138) {
	harness.window.location.href = "https://letters.thedankoe.com/p/the-one-human-business-how-to-earn";
	harness.root.innerHTML = '<article class="typography newsletter-post post"><div class="available-content"><div class="body markup"></div></div></article>';
	const body = harness.root.querySelector(".body.markup");
	return Array.from({ length: count }, (_, index) => {
		const source = harness.document.createElement("p");
		source.textContent = `Article paragraph ${index}: Independent work requires a clear offer, useful writing, and a reliable way to reach readers.`;
		body.append(source);
		return source;
	});
}

// 验证长文章初扫无布局的正文仅靠内层滚动恢复，不依赖属性变化也不重复请求。
test("滚动恢复初扫暂不可布局的长文章段落", async () => {
	const harness = createContentHarness();
	try {
		const sources = mountArticle(harness);
		let revealed = false;
		for (const [index, source] of sources.entries()) {
			setRectangle(source, () => rectangle(index * 80, index < 5 || revealed));
		}
		harness.start();
		await waitFor(() => /已覆盖 5 个文本块/u.test(harness.statusText()));
		assert.equal(harness.requestCount(sources[5].textContent), 0);

		revealed = true;
		harness.root.dispatchEvent(new harness.window.Event("scroll", { bubbles: false }));
		await waitFor(() => sources.every((source) => harness.getTranslation(source)), "滚动后仍有正文漏译");
		await waitFor(() => /已覆盖 138 个文本块/u.test(harness.statusText()));
		for (const source of sources) {
			assert.equal(harness.requestCount(source.textContent), 1);
		}
		harness.root.dispatchEvent(new harness.window.Event("scroll"));
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(harness.document.querySelectorAll(".bt-translation").length, sources.length);
	} finally {
		harness.dispose();
	}
});

// 验证持续滚动不会无限推迟恢复，关闭动态新增翻译仍补齐初始扫描的正文。
test("连续滚动有界恢复已发现正文且不阻塞完成", async () => {
	const harness = createContentHarness({ translateDynamicContent: false });
	let scrollTimer;
	try {
		const [visible, deferred] = mountArticle(harness, 2);
		let revealed = false;
		setRectangle(deferred, () => rectangle(100, revealed));
		harness.start();
		await waitFor(() => Boolean(harness.getTranslation(visible)));
		revealed = true;
		scrollTimer = setInterval(() => harness.window.dispatchEvent(new harness.window.Event("scroll")), 12);
		await waitFor(() => Boolean(harness.getTranslation(deferred)), "连续滚动饿死了恢复任务");
		await waitFor(() => /已覆盖 2 个文本块/u.test(harness.statusText()));
		assert.equal(harness.requestCount(deferred.textContent), 1);
	} finally {
		clearInterval(scrollTimer);
		harness.dispose();
	}
});

// 验证尺寸变化可以恢复待翻译段落，已移除正文及停止后的事件不会触发请求。
test("窗口尺寸变化恢复正文，停止时清理待处理滚动", async () => {
	const harness = createContentHarness();
	try {
		const [visible, resized, removed, stopped] = mountArticle(harness, 4);
		let revealed = false;
		let revealStopped = false;
		setRectangle(resized, () => rectangle(100, revealed));
		setRectangle(removed, () => rectangle(200, revealed));
		setRectangle(stopped, () => rectangle(300, revealStopped));
		harness.start();
		await waitFor(() => /已覆盖 1 个文本块/u.test(harness.statusText()));
		removed.remove();
		revealed = true;
		harness.window.dispatchEvent(new harness.window.Event("resize"));
		await waitFor(() => Boolean(harness.getTranslation(resized)), "尺寸变化后正文未恢复");
		assert.ok(harness.getTranslation(visible));
		assert.equal(harness.requestCount(removed.textContent), 0);
		harness.window.dispatchEvent(new harness.window.Event("scroll"));
		revealStopped = true;
		harness.injectAgain();
		await waitFor(() => harness.messages.some(({ type }) => type === "CANCEL_RUN"));
		harness.window.dispatchEvent(new harness.window.Event("resize"));
		await new Promise((resolve) => setTimeout(resolve, 350));
		assert.equal(harness.requestCount(stopped.textContent), 0);
		assert.equal(harness.document.querySelectorAll(".bt-translation, [data-bt-loading]").length, 0);
	} finally {
		harness.dispose();
	}
});

// 验证完成结算期间滚动发现正文会立即阻止完成，避免短暂报告缺失段落的成功。
test("完成结算期间滚动不会先完成再补译", async () => {
	const harness = createContentHarness();
	try {
		const [visible, deferred] = mountArticle(harness, 2);
		let revealed = false;
		setRectangle(deferred, () => rectangle(100, revealed));
		harness.start();
		await waitFor(() => Boolean(harness.getTranslation(visible)));
		await new Promise((resolve) => setTimeout(resolve, 200));
		revealed = true;
		harness.window.dispatchEvent(new harness.window.Event("scroll"));
		await waitFor(() => /已覆盖 2 个文本块/u.test(harness.statusText()));
		const completed = harness.messages.filter(({ type, state }) => type === "STATUS" && state === "done");
		assert.equal(completed.length, 1, "滚动恢复前不应提前报告完成");
	} finally {
		harness.dispose();
	}
});

// 验证读者跳到文章后部后，下一波请求优先处理新视口，而非沿用初扫位置。
test("翻译派发前按当前阅读位置重新排序", async () => {
	const firstWave = Promise.withResolvers();
	const harness = createContentHarness({
		async translateText(text, { requestNumber }) {
			if (requestNumber <= 2) await firstWave.promise;
			return `译文：${text}`;
		},
	});
	try {
		const sources = mountArticle(harness, 90);
		let offset = 0;
		for (const [index, source] of sources.entries()) {
			setRectangle(source, () => rectangle(index * 150 - offset));
		}
		harness.start();
		await waitFor(() => harness.translationRequests.length === 2);
		const destination = sources[85];
		assert.equal(harness.requestCount(destination.textContent), 0);
		offset = 85 * 150;
		harness.window.dispatchEvent(new harness.window.Event("scroll"));
		firstWave.resolve();
		await waitFor(() => harness.translationRequests.length >= 3);
		assert.ok(harness.translationRequests[2].texts.includes(destination.textContent), "新阅读位置未进入下一批翻译");
		await waitFor(() => sources.every((source) => harness.getTranslation(source)));
		assert.ok(sources.every((source) => harness.requestCount(source.textContent) === 1));
	} finally {
		firstWave.resolve();
		harness.dispose();
	}
});

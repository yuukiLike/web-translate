import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const LONG_PARAGRAPH = Array.from({ length: 70 }, (_, index) =>
	`Observation ${index + 1}: Careful readers connect each example with the argument and preserve its original context.`,
).join(" ");

// 验证跨批次分片必须全部返回，且按原文顺序一次性渲染完整段落。
test("长段落跨批次乱序返回后才一次性渲染完整译文", async () => {
	const { harness, source, pending, releaseAll } = createLongParagraphHarness();
	try {
		harness.start();
		await waitFor(() => pending.size === 2, "前两批分片未开始请求");
		const [first, second] = [...pending.values()];
		second.resolve("第二部分译文");
		await settleResponses();
		assert.equal(Boolean(harness.getTranslation(source)), false, "仅收到一个分片时不能展示残缺段落");
		assert.equal(harness.messages.some(({ state }) => state === "done"), false);

		first.resolve("第一部分译文");
		await waitFor(() => pending.size === 3, "后续批次未开始请求");
		assert.equal(Boolean(harness.getTranslation(source)), false, "仍有后续分片时不能结束渲染");
		const third = [...pending.values()][2];
		third.resolve("第三部分译文");
		await waitFor(() => Boolean(harness.getTranslation(source)), "完整分片未生成译文");

		assert.equal(harness.getTranslation(source).textContent, "第一部分译文\n第二部分译文\n第三部分译文");
		assert.equal(source.textContent, LONG_PARAGRAPH);
		assert.equal(harness.document.querySelectorAll(".bt-translation").length, 1);
		await waitFor(() => harness.messages.some(({ state }) => state === "done"));
		assert.match(harness.statusText(), /已覆盖 1 个文本块/u);
	} finally {
		releaseAll();
		harness.dispose();
	}
});

// 验证分片失败时保留原文并报告错误，不把残缺译文标记为完成。
test("长段落分片请求失败时不保留部分译文", async () => {
	const { harness, source, pending, releaseAll } = createLongParagraphHarness();
	try {
		harness.start();
		await waitFor(() => pending.size === 2);
		const [first, second] = [...pending.values()];
		first.resolve("第一部分译文");
		await settleResponses();
		assert.equal(Boolean(harness.getTranslation(source)), false);
		second.reject(new Error("后续分片请求失败"));
		await waitFor(() => harness.messages.some(({ state }) => state === "error"));

		assert.equal(Boolean(harness.getTranslation(source)), false);
		assert.equal(harness.messages.some(({ state }) => state === "done"), false);
		assert.equal(source.hasAttribute("data-bt-loading"), false);
		assert.equal(source.textContent, LONG_PARAGRAPH);
	} finally {
		releaseAll();
		harness.dispose();
	}
});

// 验证停止会取消未完成段落，迟到响应不能恢复译文或继续派发后续分片。
test("长段落未收齐分片时停止，迟到响应不会展示部分译文", async () => {
	const { harness, source, pending, releaseAll } = createLongParagraphHarness();
	try {
		harness.start();
		await waitFor(() => pending.size === 2);
		const [first, second] = [...pending.values()];
		first.resolve("第一部分译文");
		await settleResponses();
		assert.equal(Boolean(harness.getTranslation(source)), false);

		harness.injectAgain();
		await waitFor(() => harness.messages.some(({ type }) => type === "CANCEL_RUN"));
		second.resolve("停止后返回的译文");
		await settleResponses();

		assert.equal(harness.document.querySelectorAll(".bt-translation, [data-bt-loading]").length, 0);
		assert.equal(harness.messages.some(({ state }) => state === "done"), false);
		assert.equal(pending.size, 2, "停止后不能请求后续批次");
		assert.equal(source.textContent, LONG_PARAGRAPH);
	} finally {
		releaseAll();
		harness.dispose();
	}
});

function createLongParagraphHarness() {
	const pending = new Map();
	const harness = createContentHarness({
		translateText(text) {
			const request = Promise.withResolvers();
			pending.set(text, request);
			return request.promise;
		},
	});
	const { source } = harness.addArticle(LONG_PARAGRAPH);
	return {
		harness,
		source,
		pending,
		releaseAll() {
			for (const request of pending.values()) {
				request.resolve("清理在途请求");
			}
		},
	};
}

function settleResponses() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

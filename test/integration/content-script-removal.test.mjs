import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, createDeferred, waitFor } from "../helpers/content-dom-harness.mjs";

// 验证请求中的元素被移除后，完成提示保持单调且不再展示会抖动的 x/y 比例。
test("移除待处理正文后完成计数保持稳定", async () => {
	const pendingResponse = createDeferred();
	const pendingText = "Remove this paragraph before its response.";
	const harness = createContentHarness({
		async translateText(text) {
			if (text === pendingText) {
				await pendingResponse.promise;
			}
			return `译文：${text}`;
		},
	});
	try {
		const completed = harness.addArticle("The first paragraph completes.");
		harness.start();
		await waitFor(() => Boolean(harness.getTranslation(completed.source)), "首段译文未完成");
		await waitFor(
			() => harness.statusText() === "双语翻译完成，已覆盖 1 个文本块",
			"首轮完成提示不正确",
		);

		const pending = harness.addArticle(pendingText);
		await waitFor(() => harness.requestCount(pendingText) === 1, "待移除正文没有发出请求");
		pending.article.remove();
		await waitFor(
			() => pending.source.dataset.btSource === undefined,
			"移除待处理正文后仍残留运行标记",
		);
		pendingResponse.resolve();
		await waitFor(
			() => harness.statusText().startsWith("双语翻译完成"),
			"移除待处理正文后没有回到完成状态",
		);

		assert.equal(harness.statusText(), "双语翻译完成，已覆盖 1 个文本块");
		assert.equal(harness.statusText().includes("/"), false);
	} finally {
		pendingResponse.resolve();
		harness.dispose();
	}
});

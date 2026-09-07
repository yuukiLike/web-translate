import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import {
	backgroundCatalog,
	backgroundCore,
	createChromeHarness,
	createConfiguredSettings,
	createProviderRuntimeFake,
	createWebpageSender,
	sendAppMessage,
} from "../helpers/background-harness.mjs";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";
import { mountReaderArticle, READER_ARTICLE_URL } from "../helpers/reader-article-fixture.mjs";

// 验证博客页标题和十四个长段落经过真实后台恢复后全部渲染，保留链接和元数据过滤。
test("长博客文章在首次模型 JSON 非法后仍完成整页翻译", async () => {
	const content = createContentHarness();
	const background = createChromeHarness({
		settings: createConfiguredSettings({ debugLogging: true }),
	});
	const provider = createProviderRuntimeFake();
	const attempts = [];
	const app = createBackgroundApp({
		chrome: background.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		providerRuntime: {
			async generateTranslation(request) {
				attempts.push(JSON.parse(request.messages[0].content).segments);
				if (attempts.length === 1) {
					return {
						text: '{"translations":[{"id":"broken","text":"a "quoted" response"}]}',
						finishReason: "stop",
						usage: { inputTokens: 11, outputTokens: 7 },
					};
				}
				return provider.generateTranslation(request);
			},
		},
	});
	try {
		content.window.location.href = READER_ARTICLE_URL;
		const sources = mountReaderArticle(content.document);
		const originalTexts = sources.map((source) => source.textContent);
		const links = [...content.document.querySelectorAll("article p a")];
		await app.start();
		content.window.chrome.runtime.sendMessage = (message) => {
			content.messages.push(structuredClone(message));
			return sendAppMessage(app, message, createWebpageSender({ url: READER_ARTICLE_URL }));
		};
		content.start();
		await waitFor(
			() => content.messages.some((message) => message.type === "STATUS" &&
				["done", "error"].includes(message.state)),
			"博客翻译未完成或未报告错误",
		);
		const error = content.messages.find((message) => message.state === "error");
		assert.equal(error?.error, undefined, `文章翻译失败：${error?.error}`);
		assert.equal(sources.length, 15);
		for (const [index, source] of sources.entries()) {
			assert.ok(content.getTranslation(source), `第 ${index + 1} 块缺少译文`);
			assert.equal(source.textContent, originalTexts[index]);
		}
		assert.ok(links.every((link) => link.isConnected));
		assert.equal(content.getTranslation(content.document.querySelector("time")), null);
		const translatedTexts = provider.requests.flatMap((request) =>
			JSON.parse(request.messages[0].content).segments.map((segment) => segment.text),
		);
		assert.equal(new Set(translatedTexts).size, 15);
		assert.equal(translatedTexts.length, 15);
		assert.equal(attempts.length, provider.requests.length + 1);
		await waitFor(() => /已覆盖 15 个文本块/u.test(content.statusText()), "完成状态未显示全部文本块");
		const usage = background.local.data[backgroundCore.USAGE_KEY];
		const month = usage[backgroundCore.getMonthKey()].deepseek;
		assert.equal(month.apiCalls, attempts.length);

		content.injectAgain();
		await waitFor(() => content.messages.some(({ type }) => type === "CANCEL_RUN"), "停止未取消任务");
		assert.equal(content.document.querySelectorAll(".bt-translation, [data-bt-loading]").length, 0);
	} finally {
		content.dispose();
	}
});

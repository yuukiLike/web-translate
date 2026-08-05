import assert from "node:assert/strict";
import test from "node:test";

import {
	createContentHarness,
	createDeferred,
	waitFor,
} from "../helpers/content-dom-harness.mjs";

// 验证自动模式只翻译外文正文，纯中文内容不会进入云请求。
test("自动模式跳过纯中文正文", async () => {
	const harness = createContentHarness();
	try {
		const english = harness.addArticle("A readable English paragraph.");
		const chinese = harness.addArticle("这是一段不需要翻译的中文正文。");
		harness.start();

		await waitFor(
			() => harness.getTranslation(english.source)?.textContent.includes("A readable"),
			"英文正文没有生成译文",
		);
		await new Promise((resolve) => setTimeout(resolve, 230));
		assert.equal(harness.requestCount("A readable English paragraph."), 1);
		assert.equal(harness.requestCount("这是一段不需要翻译的中文正文。"), 0);
		assert.equal(harness.getTranslation(chinese.source), null);
	} finally {
		harness.dispose();
	}
});

// 验证整页只有中文时使用中性说明，并提供明确的语言设置入口而不是报错。
test("纯中文页面显示合适的无需翻译提示", async () => {
	const harness = createContentHarness();
	try {
		harness.addArticle("这是一篇完全由中文组成的文章，不需要发送到翻译服务。");
		harness.start();

		await waitFor(
			() => harness.statusText() === "当前页面没有需要翻译的外语正文",
			"纯中文页面没有显示无需翻译提示",
		);
		const action = harness.document.querySelector(".bt-status__action");
		assert.equal(action?.textContent, "调整语言设置");
		assert.equal(harness.translationRequests.length, 0);
		action.click();
		await waitFor(
			() => harness.messages.some((message) => message.type === "OPEN_OPTIONS"),
			"语言设置入口没有打开设置页",
		);
	} finally {
		harness.dispose();
	}
});

// 验证用户明确选择译为英文时，中文正文仍会按 zh -> en 方向翻译。
test("显式英文模式可以翻译中文正文", async () => {
	const harness = createContentHarness({ targetMode: "en" });
	try {
		const chinese = harness.addArticle("这段中文需要翻译成英文。", { lang: "zh-CN" });
		harness.start();

		await waitFor(
			() => Boolean(harness.getTranslation(chinese.source)),
			"显式英文模式没有生成译文",
		);
		assert.deepEqual(
			harness.translationRequests.map(({ sourceLanguage, targetLanguage }) => ({
				sourceLanguage,
				targetLanguage,
			})),
			[{ sourceLanguage: "zh", targetLanguage: "en" }],
		);
	} finally {
		harness.dispose();
	}
});

// 验证译文被删、布局改变及原节点重插都复用运行缓存，只有原文改变才重新请求。
test("动态 DOM 复用运行缓存并识别正文变化", async () => {
	const sourceText = "Cache this translated paragraph.";
	const updatedText = "The paragraph now contains new content.";
	const harness = createContentHarness();
	try {
		const item = harness.addArticle(sourceText);
		harness.start();
		await waitFor(() => Boolean(harness.getTranslation(item.source)), "初始译文未生成");

		const firstTranslation = harness.getTranslation(item.source);
		firstTranslation.remove();
		await waitFor(
			() => {
				const current = harness.getTranslation(item.source);
				return Boolean(current && current !== firstTranslation);
			},
			"被删除的译文没有恢复",
		);
		assert.equal(harness.requestCount(sourceText), 1);

		const beforeLayout = harness.getTranslation(item.source);
		item.article.setAttribute("style", "display:flex;flex-direction:row");
		await waitFor(
			() => {
				const current = harness.getTranslation(item.source);
				return Boolean(current && current !== beforeLayout);
			},
			"布局变化后译文没有重新定位",
		);
		assert.equal(harness.requestCount(sourceText), 1);

		item.article.remove();
		await waitFor(
			() => item.source.dataset.btSource === undefined,
			"移除正文后仍残留运行标记",
		);
		harness.root.append(item.article);
		await waitFor(() => Boolean(harness.getTranslation(item.source)), "重插正文后译文未恢复");
		assert.equal(harness.requestCount(sourceText), 1);

		item.source.textContent = updatedText;
		await waitFor(
			() => harness.getTranslation(item.source)?.textContent.includes(updatedText),
			"正文变化后没有生成新译文",
		);
		assert.equal(harness.requestCount(updatedText), 1);
	} finally {
		harness.dispose();
	}
});

// 验证重复注入依次执行关闭和重启，旧运行的迟到响应不能覆盖新运行译文。
test("重复注入隔离旧运行响应并完整停止", async () => {
	const oldResponse = createDeferred();
	const sourceText = "Do not render a stale response.";
	const harness = createContentHarness({
		async translateText(_text, { requestNumber }) {
			if (requestNumber === 1) {
				await oldResponse.promise;
				return "旧运行译文";
			}
			return "新运行译文";
		},
	});
	try {
		const item = harness.addArticle(sourceText);
		harness.start();
		await waitFor(() => harness.requestCount(sourceText) === 1, "首个运行没有发出请求");

		harness.injectAgain();
		await waitFor(
			() => harness.messages.some(({ type }) => type === "CANCEL_RUN"),
			"重复注入没有关闭首个运行",
		);
		assert.equal(item.source.dataset.btSource, undefined);

		harness.injectAgain();
		await waitFor(
			() => harness.getTranslation(item.source)?.textContent === "新运行译文",
			"第三次注入没有启动新运行",
		);
		oldResponse.resolve();
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(harness.getTranslation(item.source)?.textContent, "新运行译文");

		harness.injectAgain();
		await waitFor(
			() => harness.document.querySelectorAll(".bt-translation, [data-bt-source]").length === 0,
			"停止后仍残留翻译节点或运行标记",
		);
		assert.ok(harness.messages.every((message) => message.type !== "STATUS" || message.runId));
	} finally {
		oldResponse.resolve();
		harness.dispose();
	}
});

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

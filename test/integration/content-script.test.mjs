import assert from "node:assert/strict";
import test from "node:test";

import {
	createContentHarness,
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

// 验证自动译为英文只提交检测为中文的正文，英文正文会因来源与目标相同而跳过。
test("自动来源可以译为英文并跳过英文正文", async () => {
	const harness = createContentHarness({ sourceMode: "auto", targetMode: "en" });
	try {
		const chinese = harness.addArticle("这段中文需要翻译成英文。", { lang: "zh-CN" });
		const english = harness.addArticle("This English paragraph is already in the target language.");
		harness.start();

		await waitFor(
			() => Boolean(harness.getTranslation(chinese.source)),
			"自动英文目标没有生成中文译文",
		);
		await new Promise((resolve) => setTimeout(resolve, 230));
		assert.deepEqual(
			harness.translationRequests.map(({ sourceLanguage, targetLanguage }) => ({
				sourceLanguage,
				targetLanguage,
			})),
			[{ sourceLanguage: "zh", targetLanguage: "en" }],
		);
		assert.equal(harness.requestCount(english.source.textContent), 0);
		assert.equal(harness.getTranslation(english.source), null);
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

// 验证正文内部未知子节点的样式变化不会误删并重建已有译文。
test("内部装饰节点变化不会造成译文跳动", async () => {
	const harness = createContentHarness();
	try {
		const item = harness.addArticle("Keep this translated paragraph stable.");
		const badge = harness.document.createElement("span");
		item.source.append(badge);
		harness.start();

		await waitFor(() => Boolean(harness.getTranslation(item.source)), "初始译文未生成");
		const translation = harness.getTranslation(item.source);
		badge.className = "updated-decoration";
		await new Promise((resolve) => setTimeout(resolve, 550));
		assert.equal(harness.getTranslation(item.source), translation);

		harness.root.className = "updated-feed-container";
		await new Promise((resolve) => setTimeout(resolve, 550));
		assert.equal(harness.getTranslation(item.source), translation);
		assert.equal(harness.requestCount("Keep this translated paragraph stable."), 1);
	} finally {
		harness.dispose();
	}
});

// 验证同文本从普通正文切换为短链接时移除译文，恢复正文后只复用运行缓存。
test("动态 role 切换会重新应用短链接过滤并复用缓存", async () => {
	const sourceText = "Read docs";
	const harness = createContentHarness();
	try {
		const source = harness.document.createElement("div");
		source.textContent = sourceText;
		harness.root.append(source);
		harness.start();

		await waitFor(() => Boolean(harness.getTranslation(source)), "普通正文没有生成初始译文");
		assert.equal(harness.requestCount(sourceText), 1);

		source.setAttribute("role", "link");
		await waitFor(
			() => harness.getTranslation(source) === null,
			"同文本变为短链接后旧译文没有移除",
		);
		assert.equal(harness.requestCount(sourceText), 1);

		source.removeAttribute("role");
		await waitFor(
			() => Boolean(harness.getTranslation(source)),
			"短链接恢复为普通正文后没有恢复译文",
		);
		assert.equal(harness.requestCount(sourceText), 1);
	} finally {
		harness.dispose();
	}
});

// 验证请求发出后候选变为短链接时，迟到的旧响应不能再写入页面。
test("在途翻译响应不会渲染到已变为短链接的候选", async () => {
	const sourceText = "Read docs";
	const responseGate = Promise.withResolvers();
	const harness = createContentHarness({
		async translateText(text) {
			if (text === sourceText) {
				await responseGate.promise;
			}
			return `译文：${text}`;
		},
	});
	try {
		const source = harness.document.createElement("div");
		source.textContent = sourceText;
		harness.root.append(source);
		harness.start();

		await waitFor(() => harness.requestCount(sourceText) === 1, "初始翻译请求没有发出");
		source.setAttribute("role", "link");
		await new Promise((resolve) => setTimeout(resolve, 30));
		responseGate.resolve();

		await waitFor(
			() => /^(?:当前页面没有|双语翻译完成)/u.test(harness.statusText()),
			"迟到响应返回后翻译运行没有收敛",
		);
		assert.equal(harness.getTranslation(source), null);
		assert.equal(harness.requestCount(sourceText), 1);
	} finally {
		responseGate.resolve();
		harness.dispose();
	}
});

// 验证重复注入依次执行关闭和重启，旧运行的迟到响应不能覆盖新运行译文。
test("重复注入隔离旧运行响应并完整停止", async () => {
	const oldResponse = Promise.withResolvers();
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

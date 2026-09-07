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
		settings: createConfiguredSettings({ debugLogging: true, debugRequestPayload: true }),
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
		const debug = await sendAppMessage(app, { type: "GET_DEBUG_LOGS" });
		const contentEvents = debug.events.filter(({ eventType }) => eventType === "content.planned");
		const tracedNodes = contentEvents.flatMap(({ contentTrace }) => contentTrace.nodes);
		const tracedSegments = contentEvents.flatMap(({ contentTrace }) => contentTrace.segments);
		assert.equal(tracedNodes.length, sources.length, "所有已选正文都应出现在调试计划中");
		assert.deepEqual(tracedNodes.map(({ text }) => text).sort(), originalTexts.map(backgroundCore.normalizeSourceText).sort());
		const plannedIds = new Set(tracedSegments.map(({ id }) => id));
		assert.ok(attempts.flat().every(({ id }) => plannedIds.has(id)), "恢复后的实际请求也应关联原文分片");
		assert.ok(tracedSegments.every(({ targets }) => targets.every(({ nodeId }) =>
			tracedNodes.some(({ id }) => id === nodeId))), "分片必须关联已记录的正文节点");
		assertRequestLinks(debug.events, tracedSegments, provider.requests);

		content.injectAgain();
		await waitFor(() => content.messages.some(({ type }) => type === "CANCEL_RUN"), "停止未取消任务");
		assert.equal(content.document.querySelectorAll(".bt-translation, [data-bt-loading]").length, 0);
	} finally {
		content.dispose();
	}
});

function assertRequestLinks(events, plannedSegments, providerRequests) {
	const batches = new Map(events.filter(({ eventType }) => eventType === "batch.received")
		.map((event) => [event.batchId, event]));
	const requests = events.filter(({ eventType }) => eventType === "sdk.request-start");
	const models = new Map(events.filter(({ eventType }) => eventType === "model.request.started")
		.map((event) => [event.modelRequestId, event]));
	const planned = new Map(plannedSegments.map((segment) => [segment.id, segment.text]));
	assert.equal(requests.length, providerRequests.length, "每次实际服务请求都应有独立SDK记录");
	assert.deepEqual([...batches.values()].flatMap(({ segmentIds }) => segmentIds).sort(), [...planned.keys()].sort());
	assert.ok(requests.some(({ recoveryDepth }) => recoveryDepth > 0), "应记录首次格式失败后的恢复请求");
	for (const event of requests) {
		const batch = batches.get(event.batchId);
		const model = models.get(event.modelRequestId);
		assert.ok(batch && model, "SDK请求必须关联原始批次和模型调用");
		assert.equal(model.batchId, batch.batchId);
		assert.notEqual(event.requestId, event.modelRequestId, "HTTP请求与模型调用使用各自的身份");
		const userMessage = event.requestPayload.messages.find(({ role }) => role === "user");
		const payload = JSON.parse(userMessage.content);
		assert.deepEqual(payload.segments.map(({ id }) => id), event.segmentIds);
		assert.ok(payload.segments.every(({ id, text }) => planned.get(id) === text), "实际请求正文必须对应已记录的原文");
		assert.ok(event.rootSegmentIds.every((id) => batch.segmentIds.includes(id)));
		assert.ok(providerRequests.some((request) => request.messages[0].content === userMessage.content));
		if (event.recoveryDepth > 0) {
			const parent = models.get(event.parentModelRequestId);
			assert.ok(parent, "恢复分片必须关联发生错误的父模型请求");
			assert.equal(parent.batchId, batch.batchId);
		}
	}
}

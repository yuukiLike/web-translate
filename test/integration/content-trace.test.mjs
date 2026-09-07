import assert from "node:assert/strict";
import test from "node:test";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

function traces(harness) {
	return harness.messages.filter(({ type }) => type === "CONTENT_TRACE").map(({ trace }) => trace);
}

// 验证真实扫描与分片之后仍可从调试计划还原长正文和全部重复节点。
test("实际正文计划保留完整原文、分片顺序及重复DOM位置", async () => {
	const harness = createContentHarness({ captureContentTrace: true });
	try {
		const text = "A careful reader checks every sentence before accepting a translation. ".repeat(70).trim();
		const first = harness.addArticle(text);
		const second = harness.addArticle(text);
		harness.start();
		await waitFor(() => Boolean(harness.getTranslation(first.source) && harness.getTranslation(second.source)));
		await waitFor(() => traces(harness).length > 0);
		const plans = traces(harness);
		const nodes = plans.flatMap((trace) => trace.nodes);
		const segments = plans.flatMap((trace) => trace.segments);
		assert.equal(nodes.length, 2);
		assert.ok(nodes.every((node) => node.text === text && node.tag === "p" && node.revision === 1));
		assert.ok(segments.length > 1, "长正文应拆成多个分片");
		assert.ok(segments.every((item) => item.targets.length === 2 && item.cache === "pending"));
		for (const node of nodes) {
			const parts = segments.flatMap((item) => item.targets
				.filter((target) => target.nodeId === node.id)
				.map((target) => ({ ...target, text: item.text })));
			assert.equal(parts.length, segments.length);
			assert.ok(parts.every((part) => part.partCount === segments.length));
			assert.equal(parts.sort((left, right) => left.partIndex - right.partIndex).map((part) => part.text).join(" "), text);
		}
		const submittedIds = harness.messages.filter(({ type }) => type === "TRANSLATE_BATCH")
			.flatMap(({ segments: submitted }) => submitted.map(({ id }) => id));
		assert.deepEqual(submittedIds.sort(), segments.map(({ id }) => id).sort());
	} finally {
		harness.dispose();
	}
});

// 验证新增正文命中本轮缓存时照常记录来源，并且不会额外调用翻译服务。
test("动态新增的重复正文即使命中运行缓存也保留新节点记录", async () => {
	const harness = createContentHarness({ captureContentTrace: true });
	try {
		const text = "This paragraph is reused in a later dynamically inserted article.";
		const first = harness.addArticle(text);
		harness.start();
		await waitFor(() => Boolean(harness.getTranslation(first.source)));
		const second = harness.addArticle(text);
		await waitFor(() => Boolean(harness.getTranslation(second.source)));
		await waitFor(() => traces(harness).some((trace) => trace.segments.some(({ cache }) => cache === "memory")));
		const initial = traces(harness).find((trace) => trace.segments.some(({ cache }) => cache === "pending"));
		const cached = traces(harness).find((trace) => trace.segments.some(({ cache }) => cache === "memory"));
		assert.notEqual(cached.scanId, initial.scanId);
		assert.notEqual(cached.nodes[0].id, initial.nodes[0].id);
		assert.equal(cached.nodes[0].text, text);
		assert.equal(harness.requestCount(text), 1, "缓存命中不产生新的翻译请求");
	} finally {
		harness.dispose();
	}
});

// 验证正文记录默认关闭，且开启后的消息错误只影响调试记录。
test("默认不报告原文；授权后的日志消息失败也不影响翻译", async () => {
	for (const captureContentTrace of [false, true]) {
		const harness = createContentHarness({ captureContentTrace });
		try {
			const send = harness.window.chrome.runtime.sendMessage;
			harness.window.chrome.runtime.sendMessage = async (message) => {
				if (message.type.startsWith("CONTENT_TRACE")) {
					harness.messages.push(structuredClone(message));
					throw new Error("The debug store is temporarily unavailable");
				}
				return send(message);
			};
			const { source } = harness.addArticle("Translation should remain available even when debug logging fails.");
			harness.start();
			await waitFor(() => Boolean(harness.getTranslation(source)));
			assert.equal(traces(harness).length > 0, captureContentTrace);
			assert.equal(harness.messages.some(({ state }) => state === "error"), false);
		} finally {
			harness.dispose();
		}
	}
});

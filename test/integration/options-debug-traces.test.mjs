import assert from "node:assert/strict";
import test from "node:test";
import { clickByText, createOptionsPageHarness, settle, waitFor } from "../helpers/options-page-harness.mjs";

const source = 'The reader says: <script>window.bad = true</script>\nNext paragraph.';
const payload = {
	model: "deepseek-v4-flash", max_tokens: 1024,
	messages: [
		{ role: "system", content: "Translate the provided segments.\nKeep every id." },
		{ role: "user", content: JSON.stringify({ source_language: "English", target_language: "Simplified Chinese", segments: [{ id: "part-1", text: source }] }) },
	],
};
const context = { runId: "run-1", tabId: 12, provider: "deepseek", timestamp: "2026-09-07T08:00:00Z", workerInstanceId: "worker-1" };
function events() {
	return [
		{ ...context, seq: 1, eventType: "content.planned", contentTrace: {
			version: 1, scanId: "scan-1", nodeCount: 1, segmentCount: 1,
			document: { title: "The revolt of the reader", url: "https://example.com/reader" },
			nodes: [{ id: "node-1", tag: "p", path: "html > body > article > p", revision: 1, text: source }],
			segments: [{ id: "part-1", text: source, sourceLanguage: "en", targetLanguage: "zh", cache: "pending", targets: [{ nodeId: "node-1", partIndex: 0, partCount: 1 }] }],
		} },
		{ ...context, seq: 2, eventType: "cache.resolved", batchId: "batch-1", batchIndex: 1, segmentIds: ["part-1"], cacheMissIds: ["part-1"] },
		{ ...context, seq: 3, eventType: "sdk.request-start", batchId: "batch-1", requestId: "http-1", modelRequestId: "model-1", segmentIds: ["part-1"], rootSegmentIds: ["part-1"], attempt: 1, method: "POST", endpoint: "https://api.deepseek.com/chat/completions", requestPayload: payload },
		{ ...context, seq: 4, eventType: "sdk.request-end", batchId: "batch-1", requestId: "http-1", modelRequestId: "model-1", attempt: 1, httpStatus: 200, elapsedMs: 52 },
	];
}
async function openDebug(options = {}) {
	const page = await createOptionsPageHarness({ ...options, settings: {
		provider: "deepseek", debugLogging: true, debugRequestPayload: true,
		deepseek: { apiKey: "test-key", model: "deepseek-v4-flash" },
	} });
	clickByText(page.document, ".tabs button", "调试");
	await waitFor(() => page.ports.length === 1, "调试连接未建立");
	await settle();
	return page;
}

// 从原文结构进入关联请求后，真实换行、消息、JSON与复制必须一致且全部作为纯文本渲染。
test("调试页贯通原文分片实际请求并安全格式化展示", async () => {
	const page = await openDebug();
	try {
		page.ports[0].onMessage.emit({ type: "DEBUG_SNAPSHOT", events: events(), retention: { droppedEvents: 0 } });
		await settle();
		assert.equal(page.document.querySelector(".trace-run-heading h2").textContent, "The revolt of the reader");
		assert.equal(page.document.querySelector(".trace-source").textContent, source);
		assert.match(page.document.querySelector(".trace-breadcrumb").textContent, /article/u);
		assert.equal(page.document.querySelectorAll(".trace-outline button").length, 1);
		assert.match(page.document.querySelector(".trace-route").textContent, /DeepSeek/u);
		const request = page.document.querySelector(".trace-detail .debug-event");
		request.open = true;
		request.dispatchEvent(new page.window.Event("toggle"));
		await settle();
		assert.equal(page.document.querySelector(".request-text").textContent, payload.messages[0].content);
		assert.equal(page.document.querySelector(".request-segment .request-text").textContent, source);
		assert.equal(page.document.querySelector("#debug script"), null);
		clickByText(page.document, ".request-view-controls button", "请求 JSON");
		await settle();
		assert.match(page.document.querySelector(".debug-json").textContent, /max_tokens/u);
		page.document.querySelector(".request-copy").click();
		await settle();
		assert.deepEqual(JSON.parse(page.copiedText), payload);
	} finally { page.cleanup(); }
});

// 正文授权撤回或保留窗口淘汰时，打开的详情必须立即丢弃旧正文并明确显示记录缺失。
test("调试实时快照清除已展开正文并说明窗口淘汰", async () => {
	const page = await openDebug();
	try {
		page.ports[0].onMessage.emit({ type: "DEBUG_SNAPSHOT", events: events() });
		await settle();
		clickByText(page.document, ".debug-modes button", "HTTP 请求");
		await settle();
		const request = page.document.querySelector(".debug-event");
		request.open = true;
		request.dispatchEvent(new page.window.Event("toggle"));
		await settle();
		assert.ok(page.document.querySelector(".request-messages"));
		const scrubbed = events().map(({ contentTrace, requestPayload, ...event }) => event);
		page.ports[0].onMessage.emit({ type: "DEBUG_SNAPSHOT", events: scrubbed, retention: { droppedEvents: 7 } });
		await settle();
		assert.equal(page.document.querySelector(".request-messages"), null);
		assert.match(page.document.querySelector(".capture-notice").textContent, /没有保存正文/u);
		assert.match(page.document.querySelector(".trace-notice").textContent, /7 条旧事件/u);
		assert.doesNotMatch(page.document.querySelector("#debug").textContent, /window.bad/u);
	} finally { page.cleanup(); }
});

// 关闭任一记录开关都应本地清除已展开正文，不能依赖已断开的Port发送清洗快照。
test("关闭记录开关立即清除页面内正文与复制数据", async () => {
	for (const id of ["debug-logging", "debug-request-payload"]) {
		const page = await openDebug();
		try {
			page.ports[0].onMessage.emit({ type: "DEBUG_SNAPSHOT", events: events() });
			await settle();
			assert.equal(page.document.querySelector(".trace-source").textContent, source);
			const checkbox = page.document.getElementById(id);
			checkbox.checked = false;
			checkbox.dispatchEvent(new page.window.Event("change", { bubbles: true }));
			await waitFor(() => !page.document.querySelector(".trace-source"), "撤回授权后仍保留原文");
			page.ports[0].onMessage.emit({ type: "DEBUG_SNAPSHOT", events: events() });
			await settle();
			assert.doesNotMatch(page.document.querySelector("#debug").textContent, /window.bad/u);
			page.document.querySelector("#copy-debug-logs").click();
			await settle();
			assert.doesNotMatch(page.copiedText, /window.bad|Translate the provided/u);
		} finally { page.cleanup(); }
	}
});

// 实时清空已经生效后，晚到的GET快照不能让已清除正文重新出现在界面。
test("晚到的读取快照不覆盖实时清空结果", async () => {
	const response = Promise.withResolvers();
	const page = await openDebug({ getDebugLogs: () => response.promise });
	try {
		page.ports[0].onMessage.emit({ type: "DEBUG_SNAPSHOT", events: events() });
		await settle();
		page.ports[0].onMessage.emit({ type: "DEBUG_RESET" });
		response.resolve({ ok: true, events: events() });
		await settle();
		assert.equal(page.document.querySelector(".trace-source"), null);
		assert.doesNotMatch(page.document.querySelector("#debug").textContent, /window.bad/u);
	} finally {
		response.resolve({ ok: true, events: [] });
		page.cleanup();
	}
});

// 清空确认返回前新到达的真实事件必须保留，不能被本地二次清空覆盖。
test("清空操作保留重置之后到达的新事件", async () => {
	const response = Promise.withResolvers();
	const page = await openDebug({ clearDebugLogs: () => response.promise });
	try {
		page.document.querySelector("#clear-debug-logs").click();
		await waitFor(() => page.calls.some((message) => message.type === "CLEAR_DEBUG_LOGS"), "清空请求未发送");
		page.ports[0].onMessage.emit({ type: "DEBUG_RESET" });
		for (const event of events()) page.ports[0].onMessage.emit({ type: "DEBUG_EVENT", event });
		response.resolve({ ok: true });
		await settle();
		assert.equal(page.document.querySelector(".trace-source").textContent, source);
	} finally {
		response.resolve({ ok: true });
		page.cleanup();
	}
});

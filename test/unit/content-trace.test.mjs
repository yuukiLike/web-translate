import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { batchSegments } from "../../src/core/text.js";
import { ElementStore } from "../../src/content/element-store.js";
import { CloudTranslator } from "../../src/content/translation/cloud-translator.js";
import { ContentTrace } from "../../src/content/translation/content-trace.js";
import { createContentTracePackets } from "../../src/content/translation/content-trace-packets.js";
import { RunTranslationCache } from "../../src/content/translation/run-cache.js";

function createHarness({ enabled = true, failTrace = false } = {}) {
	const window = new Window({ url: "https://example.com/article" });
	const messages = [];
	const runCache = new RunTranslationCache();
	const elementStore = new ElementStore();
	const runtime = {
		async send(message) {
			messages.push(structuredClone(message));
			if (failTrace) throw new Error("Debug store unavailable");
		},
		async translateBatch(_runId, batch) {
			return { results: batch.items.map(({ id, text }) => ({ id, text: `译文：${text}` })) };
		},
	};
	const trace = new ContentTrace({ enabled, runId: "trace-run", runtime, runCache });
	function record(text, parts = [text]) {
		const element = window.document.createElement("p");
		element.textContent = text;
		window.document.body.append(element);
		const value = {
			element, parts, sourceText: text, revision: 1, originalHash: text,
			translations: new Array(parts.length),
		};
		elementStore.setState(element, { revision: 1, originalHash: text });
		return value;
	}
	return { window, messages, runCache, elementStore, runtime, trace, record };
}

function segment(id, text, targets) {
	return { id, text, sourceLanguage: "en", targetLanguage: "zh", priority: 0, targets };
}

// 验证关闭正文授权时采集器不会访问任何页面内容，也不会发送日志。
test("未授权时不访问正文、节点或缓存，也不发送调试消息", async () => {
	const trace = new ContentTrace({
		enabled: false,
		runtime: { send() { assert.fail("不应发送消息"); } },
	});
	const unreadable = new Proxy([], { get() { assert.fail("不应读取候选内容"); } });
	await trace.recordPlan(unreadable);
	await trace.recordAliases(unreadable);
});

// 验证重复正文和长段落的节点映射完整，并在同一元素更新后保留稳定身份。
test("扫描保留原文、分片与多个目标节点的关系，节点身份跨revision稳定", async () => {
	const harness = createHarness();
	try {
		const first = harness.record("First paragraph.\nSecond paragraph.", ["First paragraph.", "Second paragraph."]);
		const duplicate = harness.record("First paragraph.");
		const segments = [
			segment("part-1", first.parts[0], [{ record: first, partIndex: 0 }, { record: duplicate, partIndex: 0 }]),
			segment("part-2", first.parts[1], [{ record: first, partIndex: 1 }]),
		];
		await harness.trace.recordPlan(segments);
		const initial = harness.messages[0].trace;
		assert.equal(initial.nodeCount, 2);
		assert.equal(initial.segmentCount, 2);
		assert.equal(initial.nodes[0].text, first.sourceText);
		assert.equal(initial.nodes[1].path, "html:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(2)");
		assert.deepEqual(initial.segments[0].targets.map(({ partIndex, partCount }) => ({ partIndex, partCount })), [
			{ partIndex: 0, partCount: 2 }, { partIndex: 0, partCount: 1 },
		]);
		assert.equal(initial.segments[1].targets[0].nodeId, initial.nodes[0].id);
		assert.equal(initial.document.url, "https://example.com/article");
		first.revision = 2;
		harness.runCache.set(segments[0], "第一段");
		await harness.trace.recordPlan([segments[0]]);
		const next = harness.messages[1].trace;
		assert.notEqual(next.scanId, initial.scanId);
		assert.equal(next.nodes[0].id, initial.nodes[0].id);
		assert.equal(next.nodes[0].revision, 2);
		assert.equal(next.segments[0].cache, "memory");
	} finally {
		harness.window.close();
	}
});

// 验证有界消息分包不会遗漏节点或目标，并明确标记真正超过正文记录上限的情况。
test("大扫描分包保留所有节点与目标映射，明确标记超过记录限制的正文", () => {
	const nodes = Array.from({ length: 1_100 }, (_, index) => ({
		id: `node-${index}`, tag: "p", path: `p:nth-of-type(${index + 1})`, revision: 1,
		text: `Paragraph ${index}: ${"x".repeat(500)}`,
	}));
	const segments = [segment("shared", "Repeated paragraph", nodes.map(({ id }) => ({
		nodeId: id, partIndex: 0, partCount: 1,
	})))];
	const packets = createContentTracePackets({ scanId: "large-scan", nodes, segments });
	assert.ok(packets.length > 1);
	assert.equal(packets.flatMap((packet) => packet.nodes).length, nodes.length);
	assert.equal(packets.flatMap((packet) => packet.segments).flatMap((item) => item.targets).length, nodes.length);
	for (const [index, packet] of packets.entries()) {
		assert.equal(packet.chunkIndex, index);
		assert.equal(packet.chunkCount, packets.length);
		assert.equal(packet.nodeCount, nodes.length);
		assert.equal(packet.segmentCount, 1);
		assert.ok(Buffer.byteLength(JSON.stringify(packet)) < 192 * 1_024);
		assert.equal(packet.truncated, undefined);
	}
	const limited = createContentTracePackets({
		scanId: "oversized", nodes: [{ ...nodes[0], text: "原".repeat(60_000) }], segments: [],
	});
	assert.equal(limited[0].truncated, true);
	assert.ok(limited[0].nodes[0].text.length < 60_000);
});

// 验证动态去重会留下实际发送分片的关联，并且调试服务失败不能阻断翻译。
test("动态重复段落合并到待发送批次时报告别名；日志失败不影响翻译", async () => {
	const harness = createHarness({ failTrace: true });
	try {
		const first = harness.record("One shared paragraph.");
		const later = harness.record("One shared paragraph.");
		const original = segment("original", first.sourceText, [{ record: first, partIndex: 0 }]);
		const duplicate = segment("duplicate", later.sourceText, [{ record: later, partIndex: 0 }]);
		const rootQueue = { size: 1, take() { this.size = 0; return []; } };
		const cloud = new CloudTranslator({
			core: { batchSegments, getProviderLimits: () => ({ maximumItems: 10, maximumCharacters: 3_000 }), getProviderMaximumConcurrency: () => 1 },
			settings: { provider: "deepseek", concurrency: 1 }, runId: "trace-run",
			runtime: harness.runtime, rootQueue, planner: { collectSegments: () => [duplicate] },
			runCache: harness.runCache, contentTrace: harness.trace,
			renderer: { renderIfReady() {} }, elementStore: harness.elementStore,
			invalidator: { invalidate() { assert.fail("日志失败不应使正文失效"); } },
			isCurrent: () => true, reportProgress: async () => {},
		});
		await cloud.translate(cloud.resolveFromRunCache([original]));
		await harness.trace.recordPlan([]);
		const alias = harness.messages.find(({ type }) => type === "CONTENT_TRACE_ALIAS");
		assert.deepEqual(alias.aliases, [{ segmentId: "duplicate", canonicalSegmentId: "original" }]);
		assert.equal(first.translations[0], "译文：One shared paragraph.");
		assert.equal(later.translations[0], first.translations[0]);
		assert.equal(harness.runCache.has(original), true);
	} finally {
		harness.window.close();
	}
});

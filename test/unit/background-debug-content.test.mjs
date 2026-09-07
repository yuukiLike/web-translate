import assert from "node:assert/strict";
import test from "node:test";
import { createDebugStore } from "../../chrome-extension/background/debug-store.js";
import { DEBUG_LIMITS, DEBUG_PORT_NAME, STORAGE_KEYS } from "../../chrome-extension/background/constants.js";
import { createSafeRequestPayload } from "../../chrome-extension/background/request-payload-sanitizer.js";
import { backgroundCore, createChromeHarness } from "../helpers/background-harness.mjs";

function contentEvent(overrides = {}) {
	return {
		provider: "deepseek", eventType: "content.planned", requestPayloadAllowed: true, incognito: false,
		contentTrace: {
			version: 1, scanId: "scan-1", nodeCount: 1, segmentCount: 1,
			document: { title: "文章标题", url: "https://user:secret@example.com/article?token=private#secret" },
			nodes: [{ id: "node-1", tag: "p", path: "article > p", revision: 1, text: "私密原文", html: "<script>secret</script>" }],
			segments: [{ id: "segment-1", text: "私密原文", sourceLanguage: "en", targetLanguage: "zh", cache: "pending", targets: [{ nodeId: "node-1", partIndex: 0, partCount: 1 }] }],
		},
		...overrides,
	};
}

async function createStore(enabled = true) {
	const harness = createChromeHarness();
	const debug = createDebugStore({ chrome: harness.chrome, core: backgroundCore, getSafeEndpoint: (url) => url });
	await debug.initialize(true, enabled);
	return { debug, harness };
}

// 验证结构记录只含安全数据，授权撤销会跨内存、存储和重启清除所有正文。
test("正文授权覆盖结构和别名，重启保留结构，撤回后清理完整内容", async () => {
	const { debug, harness } = await createStore();
	debug.record(contentEvent());
	debug.record(contentEvent({ eventType: "content.alias", contentAliases: [{ segmentId: "alias-1", canonicalSegmentId: "segment-1" }] }));
	const events = await debug.getEvents();
	assert.equal(events[0].contentTrace.document.url, "https://example.com/article");
	assert.equal(events[0].contentTrace.nodes[0].html, undefined);
	assert.deepEqual(events[1].contentAliases, [{ segmentId: "alias-1", canonicalSegmentId: "segment-1" }]);
	const restarted = createDebugStore({ chrome: harness.chrome, core: backgroundCore });
	await restarted.initialize(true, true);
	assert.deepEqual((await restarted.getEvents())[0].contentTrace, events[0].contentTrace);
	await restarted.setRequestPayloadEnabled(false);
	const scrubbed = JSON.stringify({ events: await restarted.getEvents(), stored: harness.session.data });
	assert.doesNotMatch(scrubbed, /私密原文|文章标题|article|alias-1/u);
});

// 验证任一隐私条件不满足都只留下元数据，排队事件不能利用旧授权写入。
test("未授权、无痕、其他服务和撤回前排队内容不能持久化", async () => {
	for (const [enabled, overrides] of [[false, {}], [true, { incognito: true }], [true, { provider: "openai" }]]) {
		const { debug, harness } = await createStore(enabled);
		debug.record(contentEvent(overrides));
		assert.equal((await debug.getEvents())[0].contentTrace, undefined);
		assert.doesNotMatch(JSON.stringify(harness.session.data), /私密原文/u);
	}
	const { debug, harness } = await createStore();
	debug.record(contentEvent());
	await debug.setRequestPayloadEnabled(false);
	assert.doesNotMatch(JSON.stringify({ events: await debug.getEvents(), stored: harness.session.data }), /私密原文/u);
});

// 验证大正文尽量完整保存，内容缩短和字段投影始终向面板暴露缺失信息。
test("内容截断与未知请求字段都有明确完整性标志", async () => {
	const { debug } = await createStore();
	const event = contentEvent();
	event.contentTrace.nodes[0].text = "原".repeat(60_000);
	debug.record(event);
	assert.equal((await debug.getEvents())[0].contentTrace.truncated, true);
	const body = { model: "deepseek-v4-flash", max_tokens: 2_000, temperature: 0.2, top_p: 0.9, stop: ["END"], messages: [{ role: "user", content: "x".repeat(50_000) }], unknown_setting: "secret-value" };
	const result = createSafeRequestPayload(JSON.stringify(body));
	assert.equal(result.truncated, false);
	assert.equal(result.payload.messages[0].content, body.messages[0].content);
	assert.equal(result.payload.temperature, 0.2);
	assert.deepEqual(result.omittedFields, ["other_field"]);
	assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

// 验证存储淘汰与实时面板窗口同步，用户清空记录后容量计数重新开始。
test("容量淘汰发送完整窗口与统计，重启保留计数，清空归零", async () => {
	const { debug, harness } = await createStore();
	const messages = [];
	const port = { name: DEBUG_PORT_NAME, sender: { url: "chrome-extension://test/options" }, onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage(message) { messages.push(structuredClone(message)); }, disconnect() {} };
	debug.connect(port, () => true);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(messages[0].type, "DEBUG_SNAPSHOT");
	for (let index = 0; index < DEBUG_LIMITS.maxEvents + 2; index += 1) debug.record({ eventType: "batch.received", batchIndex: index });
	const snapshot = await debug.getSnapshot();
	assert.equal(snapshot.events.length, DEBUG_LIMITS.maxEvents);
	assert.equal(snapshot.retention.droppedEvents, 2);
	assert.equal(snapshot.events[0].batchIndex, 2);
	assert.equal(messages.at(-1).type, "DEBUG_SNAPSHOT");
	assert.ok(messages.some((message) => message.type === "DEBUG_EVENT"));
	assert.equal(messages.at(-1).events.length, DEBUG_LIMITS.maxEvents);
	assert.equal(harness.session.data[STORAGE_KEYS.debugRetention].droppedEvents, 2);
	const restarted = createDebugStore({ chrome: harness.chrome, core: backgroundCore });
	await restarted.initialize(true, true);
	assert.equal((await restarted.getSnapshot()).retention.droppedEvents, 2);
	await restarted.clear();
	assert.equal((await restarted.getSnapshot()).retention.droppedEvents, 0);
});

// 验证所有实际数据损失都可被识别，未知字段名不能成为另一条泄漏路径。
test("请求投影不会把被删嵌套字段、无效消息或截短值标为完整", () => {
	const base = { model: "deepseek-v4-flash", messages: [{ role: "user", content: "source" }] };
	const nested = createSafeRequestPayload({ ...base, response_format: { type: "json_object", private_schema_key: "hidden" } });
	assert.deepEqual(nested.omittedFields, ["response_format.other_field"]);
	assert.doesNotMatch(JSON.stringify(nested), /private_schema_key|hidden/u);
	assert.equal(createSafeRequestPayload({ ...base, reasoning_effort: "x".repeat(101) }).truncated, true);
	assert.equal(createSafeRequestPayload({ ...base, messages: [...base.messages, { role: "user", content: [{ text: "hidden" }] }] }).truncated, true);
	assert.deepEqual(createSafeRequestPayload({ ...base, messages: "invalid" }).omittedFields, ["messages"]);
});

// 验证同一扫描的分包结构和跨包插入位置在后台重启后仍可完整合并。
test("节点包和分片包保留扫描计数、跨包targets及截断标志", async () => {
	const { debug, harness } = await createStore();
	const original = contentEvent();
	const nodePacket = { ...original.contentTrace, segments: [], chunkIndex: 0, chunkCount: 3, nodeCount: 8, segmentCount: 10 };
	const segment = original.contentTrace.segments[0];
	const firstPart = { ...nodePacket, nodes: [], segments: [segment], chunkIndex: 1 };
	const secondPart = { ...firstPart, segments: [{ ...segment, targets: [{ nodeId: "node-2", partIndex: 1, partCount: 2 }] }], chunkIndex: 2, truncated: true };
	for (const packet of [nodePacket, firstPart, secondPart]) debug.record({ ...original, contentTrace: packet });
	const saved = await debug.getEvents();
	const restarted = createDebugStore({ chrome: harness.chrome, core: backgroundCore });
	await restarted.initialize(true, true);
	const restored = await restarted.getEvents();
	assert.deepEqual(restored, saved);
	assert.deepEqual(restored.map((event) => event.contentTrace.chunkIndex), [0, 1, 2]);
	assert.deepEqual(restored.map((event) => event.contentTrace.nodeCount), [8, 8, 8]);
	assert.deepEqual(restored.map((event) => event.contentTrace.segmentCount), [10, 10, 10]);
	assert.equal(restored[0].contentTrace.segments.length, 0);
	assert.equal(restored[1].contentTrace.nodes.length, 0);
	assert.equal(restored[2].contentTrace.segments[0].targets[0].nodeId, "node-2");
	assert.equal(restored[2].contentTrace.truncated, true);
});

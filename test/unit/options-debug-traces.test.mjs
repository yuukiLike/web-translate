import assert from "node:assert/strict";
import test from "node:test";
import { createDebugTraces, exportDebugTrace } from "../../src/options/debugTraces.js";
import { createDebugRequests } from "../../src/options/debugRequests.js";

const planned = (trace) => ({
	eventType: "content.planned", runId: "run-1", tabId: 4,
	timestamp: "2026-09-07T08:00:00Z", contentTrace: {
		version: 1, scanId: "scan-1", nodeCount: 1, segmentCount: 1, ...trace,
	},
});
const node = { id: "node-1", tag: "p", path: "html > body > article > p", revision: 1, text: "  Source\ntext  " };
const segment = { id: "segment-1", text: node.text, sourceLanguage: "en", targetLanguage: "zh", cache: "pending", targets: [{ nodeId: node.id, partIndex: 0, partCount: 1 }] };

// 跨包的原文、分片与重复targets必须合并还原，不应丢失真实空白或误报完整性。
test("调试结构合并分包并保留完整原文及映射", () => {
	const events = [
		planned({ chunkIndex: 0, chunkCount: 3, nodes: [node], segments: [] }),
		planned({ chunkIndex: 1, chunkCount: 3, nodes: [], segments: [segment] }),
		planned({ chunkIndex: 2, chunkCount: 3, nodes: [], segments: [{ ...segment, targets: [...segment.targets, { nodeId: "node-2", partIndex: 0, partCount: 1 }] }] }),
	];
	const [run] = createDebugTraces(events, []);
	assert.equal(run.nodes.length, 1);
	assert.equal(run.nodes[0].text, node.text);
	assert.equal(run.segments.length, 1);
	assert.equal(run.segments[0].targets.length, 2);
	assert.equal(run.partial, false);
	assert.equal(createDebugTraces(events.slice(0, 2), [])[0].partial, true);
});

// 动态去重的别名和恢复请求必须回到原始分片，缓存命中不能被标成等待网络请求。
test("调试结构关联别名缓存与恢复后的实际请求", () => {
	const events = [
		planned({ nodes: [node], segments: [segment] }),
		{ eventType: "content.alias", runId: "run-1", contentAliases: [{ segmentId: "segment-1", canonicalSegmentId: "canonical" }] },
		{ eventType: "cache.resolved", runId: "run-1", batchId: "batch-1", segmentIds: ["canonical"], cacheMissIds: ["canonical"] },
		{ eventType: "sdk.request-start", runId: "run-1", batchId: "batch-1", requestId: "wire", modelRequestId: "model-child", parentModelRequestId: "model-parent", recoveryDepth: 1, segmentIds: ["split-child"], rootSegmentIds: ["canonical"], attempt: 1 },
	];
	const [run] = createDebugTraces(events, createDebugRequests(events));
	assert.equal(run.nodes[0].segments[0].requests[0].modelRequestId, "model-child");
	assert.equal(run.nodes[0].segments[0].canonicalId, "canonical");
	assert.equal(run.batchCount, 1);
	assert.match(run.nodes[0].segments[0].route, /1 次请求/u);
	const cached = createDebugTraces([
		planned({ nodes: [node], segments: [{ ...segment, cache: "memory" }] }),
	], [])[0];
	assert.equal(cached.nodes[0].segments[0].route, "本次页面缓存");
	const persisted = createDebugTraces([
		planned({ nodes: [node], segments: [segment] }),
		{ runId: "run-1", batchId: "batch", segmentIds: [segment.id], cacheHitIds: [segment.id] },
	], [])[0];
	assert.equal(persisted.nodes[0].segments[0].route, "持久缓存");
});

// 独立模型ID的校验失败应更新对应HTTP记录，不能生成一个伪请求或覆盖实际请求ID。
test("模型验证通过关联ID更新真实HTTP请求", () => {
	const rows = createDebugRequests([
		{ eventType: "sdk.request-start", requestId: "http-1", modelRequestId: "model-1", attempt: 1 },
		{ eventType: "sdk.request-end", requestId: "http-1", modelRequestId: "model-1", attempt: 1, httpStatus: 200 },
		{ eventType: "model.response.invalid", requestId: "model-1", modelRequestId: "model-1", attempt: 1, errorCode: "MODEL_RESPONSE_INVALID" },
	]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, "error");
	assert.equal(rows[0].fields.find((field) => field.key === "requestId").value, "http-1");
	assert.equal(rows[0].badge, "MODEL_RESPONSE_INVALID");
});

// 同一DOM节点的新修订保留独立快照，结构导出不复制搜索派生文本或展开后的请求树。
test("调试结构保留修订并导出可追踪的数据", () => {
	const [run] = createDebugTraces([
		planned({ nodes: [node], segments: [segment] }),
		planned({ scanId: "scan-2", nodes: [{ ...node, revision: 2, text: "changed" }], segments: [{ ...segment, id: "segment-2" }] }),
	], []);
	assert.equal(run.nodes.length, 2);
	assert.notEqual(run.nodes[0].key, run.nodes[1].key);
	const exported = exportDebugTrace(run);
	assert.equal(exported.nodes[0].text, node.text);
	assert.equal(exported.nodes[1].revision, 2);
	assert.equal(exported.segments[0].requests, undefined);
	assert.equal(exported.searchText, undefined);
});

// 重试后的验证结果属于最后一次HTTP，成功验证的用量与响应标识也须合并入同一详情。
test("重试后校验与响应元数据关联到正确尝试", () => {
	const http = [
		{ eventType: "sdk.request-end", requestId: "http-1", modelRequestId: "model", attempt: 1, httpStatus: 503 },
		{ eventType: "sdk.request-end", requestId: "http-2", modelRequestId: "model", attempt: 2, httpStatus: 200 },
	];
	const failed = createDebugRequests([...http, { eventType: "model.response.invalid", modelRequestId: "model", errorCode: "MODEL_RESPONSE_INVALID" }]);
	assert.equal(failed.length, 2);
	assert.equal(failed[1].badge, "MODEL_RESPONSE_INVALID");
	assert.equal(failed[0].badge, "HTTP 503");
	const validated = createDebugRequests([...http, { eventType: "model.response.validated", modelRequestId: "model", attempt: 2, responseId: "response", finishReason: "stop", inputTokens: 120 }]);
	assert.equal(validated.length, 2);
	assert.equal(validated[1].fields.find((field) => field.key === "inputTokens").value, "120");
	assert.equal(validated[1].fields.find((field) => field.key === "responseId").value, "response");
	assert.equal(createDebugRequests([{ eventType: "model.response.validated", modelRequestId: "missing" }]).length, 0);
});

// 导出时即便当前扫描齐全，也必须保留历史淘汰信息，防止局部记录被当成整次任务。
test("调试结构导出携带记录窗口和缺失提示", () => {
	const [run] = createDebugTraces([planned({ nodes: [node], segments: [segment] })], []);
	const exported = exportDebugTrace(run, { droppedEvents: 18, maxEvents: 600, maxBytes: 4_000_000 });
	assert.equal(run.partial, false);
	assert.equal(exported.partial, true);
	assert.equal(exported.retention.droppedEvents, 18);
	assert.equal(exported.retention.scope, "retained-scans");
});

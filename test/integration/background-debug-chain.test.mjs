import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import { backgroundCatalog, backgroundCore, createChromeHarness, createConfiguredSettings, createExtensionSender, createProviderRuntimeFake, createWebpageSender, sendAppMessage } from "../helpers/background-harness.mjs";

function createApp(overrides = {}) {
	const harness = createChromeHarness({ settings: createConfiguredSettings({ debugLogging: true, debugRequestPayload: true, ...overrides }) });
	const providerRuntime = createProviderRuntimeFake();
	const app = createBackgroundApp({ chrome: harness.chrome, core: backgroundCore, providerCatalog: backgroundCatalog, providerRuntime });
	return { app, harness, providerRuntime };
}

function traceMessage(runId = "run-trace") {
	return {
		type: "CONTENT_TRACE", runId,
		trace: {
			version: 1, scanId: "scan-1", chunkIndex: 0, chunkCount: 1, nodeCount: 1, segmentCount: 1,
			nodes: [{ id: "node-1", tag: "p", path: "article > p", revision: 1, text: "Private article" }],
			segments: [{ id: "source-1", text: "Private article", sourceLanguage: "en", targetLanguage: "zh", cache: "pending", targets: [{ nodeId: "node-1", partIndex: 0, partCount: 1 }] }],
		},
	};
}

async function events(app) {
	return (await sendAppMessage(app, { type: "GET_DEBUG_LOGS" }, createExtensionSender())).events;
}

// 验证页面不能跨任务提交记录，撤销授权后当前任务也不能继续保存正文。
test("内容记录验证主框架和活动任务并实时遵守授权，关闭后清除结构与别名", async () => {
	const { app, harness } = createApp();
	await app.start();
	const sender = createWebpageSender();
	const start = await sendAppMessage(app, { type: "START_RUN", runId: "run-trace" }, sender);
	assert.equal(start.settings.captureContentTrace, true);
	assert.equal((await sendAppMessage(app, traceMessage(), createWebpageSender({ frameId: 2 }))).ok, false);
	assert.equal((await sendAppMessage(app, traceMessage(), createWebpageSender({ tabId: 8 }))).ok, false);
	assert.equal((await sendAppMessage(app, traceMessage("run-other"), sender)).ok, false);
	assert.equal((await sendAppMessage(app, traceMessage(), sender)).captured, true);
	await sendAppMessage(app, { type: "CONTENT_TRACE_ALIAS", runId: "run-trace", aliases: [{ segmentId: "source-2", canonicalSegmentId: "source-1" }] }, sender);
	assert.equal((await events(app)).filter((event) => event.contentTrace || event.contentAliases).length, 2);
	await sendAppMessage(app, { type: "SET_DEBUG_REQUEST_PAYLOAD", enabled: false }, createExtensionSender());
	assert.equal((await sendAppMessage(app, traceMessage(), sender)).captured, false);
	assert.doesNotMatch(JSON.stringify({ events: await events(app), session: harness.session.data }), /Private article|source-2/u);
	await sendAppMessage(app, { type: "CANCEL_RUN", runId: "run-trace" }, sender);
	assert.equal((await sendAppMessage(app, traceMessage(), sender)).ok, false);
});

// 验证无痕和旧设置在启动任务时就禁用捕获，并在后台拒绝迟到正文。
test("无痕和旧调试设置不会开启页面结构捕获", async () => {
	for (const [settings, sender] of [[{}, createWebpageSender({ incognito: true })], [{ debugRequestPayload: false }, createWebpageSender()]]) {
		const { app, harness } = createApp(settings);
		await app.start();
		const start = await sendAppMessage(app, { type: "START_RUN", runId: "run-trace" }, sender);
		assert.equal(start.settings.captureContentTrace, false);
		assert.equal((await sendAppMessage(app, traceMessage(), sender)).captured, false);
		assert.doesNotMatch(JSON.stringify({ events: await events(app), session: harness.session.data }), /Private article/u);
	}
});

// 验证原始批次、恢复请求、真实上传内容与缓存命中可沿稳定标识追溯。
test("恢复子请求关联父请求及原段落，缓存命中有明确段落身份", async () => {
	const { app, providerRuntime } = createApp();
	const generate = providerRuntime.generateTranslation;
	providerRuntime.generateTranslation = async (request) => {
		const result = await generate(request);
		return providerRuntime.requests.length === 1 ? { ...result, finishReason: "length" } : result;
	};
	await app.start();
	const sender = createWebpageSender();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-chain" }, sender);
	const segments = [{ id: "one", text: "A first original paragraph." }, { id: "two", text: "A second original paragraph." }];
	const message = { type: "TRANSLATE_BATCH", runId: "run-chain", sourceLanguage: "en", targetLanguage: "zh", segments };
	assert.equal((await sendAppMessage(app, message, sender)).ok, true);
	assert.equal((await sendAppMessage(app, message, sender)).cacheHits, 2);
	const recorded = await events(app);
	const batches = recorded.filter((event) => event.eventType === "batch.received");
	assert.notEqual(batches[0].batchId, batches[1].batchId);
	const starts = recorded.filter((event) => event.eventType === "model.request.started");
	assert.deepEqual(starts.map((event) => event.segmentCount), [2, 1, 1]);
	assert.deepEqual(starts.map((event) => event.recoveryDepth), [0, 1, 1]);
	assert.deepEqual(starts.slice(1).map((event) => event.parentModelRequestId), [starts[0].modelRequestId, starts[0].modelRequestId]);
	for (const [index, child] of starts.slice(1).entries()) {
		assert.equal(child.batchId, batches[0].batchId);
		assert.deepEqual(child.rootSegmentIds, [segments[index].id]);
		assert.equal(child.sourceCharacters, segments[index].text.length);
	}
	const wire = recorded.filter((event) => event.eventType === "sdk.request-start");
	assert.equal(new Set(wire.map((event) => event.requestId)).size, 3);
	assert.deepEqual(wire.map((event) => event.modelRequestId), starts.map((event) => event.modelRequestId));
	assert.deepEqual(JSON.parse(wire[1].requestPayload.messages[1].content).segments, [segments[0]]);
	const cached = recorded.find((event) => event.eventType === "cache.resolved" && event.batchId === batches[1].batchId);
	assert.deepEqual(cached.cacheHitIds, ["one", "two"]);
	assert.deepEqual(cached.cacheMissIds, []);
	assert.equal(providerRuntime.requests.length, 3);
});

// 验证单段被再次拆分后保留原段落映射，面板不会把恢复内容误认成新网页段落。
test("单段恢复生成的临时ID仍可定位到原始段落", async () => {
	const { app, providerRuntime } = createApp();
	const generate = providerRuntime.generateTranslation;
	providerRuntime.generateTranslation = async (request) => {
		const result = await generate(request);
		return providerRuntime.requests.length === 1 ? { ...result, text: "invalid json" } : result;
	};
	await app.start();
	const sender = createWebpageSender();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-single" }, sender);
	const text = "First sentence. Second sentence with enough words.";
	const result = await sendAppMessage(app, { type: "TRANSLATE_BATCH", runId: "run-single", sourceLanguage: "en", targetLanguage: "zh", segments: [{ id: "original", text }] }, sender);
	assert.equal(result.ok, true);
	const starts = (await events(app)).filter((event) => event.eventType === "model.request.started");
	assert.equal(starts.length, 3);
	for (const event of starts.slice(1)) {
		assert.match(event.segmentIds[0], /^original__recovery_/u);
		assert.deepEqual(event.rootSegmentIds, ["original"]);
		assert.ok(event.sourceCharacters < text.length);
	}
});

// 验证重试后返回的非法响应标注实际 HTTP 尝试，不会误挂到前一次网络失败。
test("网络重试后响应校验保留最终attempt并与恢复子请求区分", async () => {
	const { app, providerRuntime } = createApp();
	const generate = providerRuntime.generateTranslation;
	providerRuntime.generateTranslation = async (request) => {
		const result = await generate(request);
		if (providerRuntime.requests.length === 1) {
			throw Object.assign(new Error("temporary unavailable"), { status: 503, retryAfterMs: 1 });
		}
		return providerRuntime.requests.length === 2 ? { ...result, text: "invalid json" } : result;
	};
	await app.start();
	const sender = createWebpageSender();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-retry-format" }, sender);
	const result = await sendAppMessage(app, {
		type: "TRANSLATE_BATCH", runId: "run-retry-format", sourceLanguage: "en", targetLanguage: "zh",
		segments: [{ id: "one", text: "First source paragraph." }, { id: "two", text: "Second source paragraph." }],
	}, sender);
	assert.equal(result.ok, true);
	const recorded = await events(app);
	const invalid = recorded.find((event) => event.eventType === "model.response.invalid");
	const wire = recorded.filter((event) => event.eventType === "sdk.request-start");
	assert.equal(invalid.modelRequestId, wire[1].modelRequestId);
	assert.equal(invalid.attempt, 2);
	assert.deepEqual(wire.slice(0, 2).map((event) => event.attempt), [1, 2]);
	const validated = recorded.filter((event) => event.eventType === "model.response.validated");
	assert.deepEqual(validated.map((event) => event.attempt), [1, 1]);
	assert.ok(validated.every((event) => event.parentModelRequestId === invalid.modelRequestId));
});

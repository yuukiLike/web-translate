import assert from "node:assert/strict";
import test from "node:test";
import { DEBUG_LIMITS, DEBUG_PORT_NAME, STORAGE_KEYS } from "../../chrome-extension/background/constants.js";
import { createDebugStore } from "../../chrome-extension/background/debug-store.js";
import { createSafeResponsePayload } from "../../chrome-extension/background/response-payload-sanitizer.js";
import { estimateStorageBytes } from "../../chrome-extension/background/utilities.js";
import { backgroundCore, createChromeHarness } from "../helpers/background-harness.mjs";

const content = JSON.stringify({ translations: [{ id: "part-1", text: "返回的私密译文\n第二行" }] });
const body = {
	id: "chatcmpl-1", object: "chat.completion", created: 123, model: "deepseek-v4-flash",
	choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
	usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10, prompt_cache_hit_tokens: 4 },
};
const event = (overrides = {}) => ({
	provider: "deepseek", eventType: "model.request.completed", requestId: "model-1",
	requestPayloadAllowed: true, incognito: false, responseBody: body, ...overrides,
});
async function createStore(enabled = true) {
	const harness = createChromeHarness();
	const debug = createDebugStore({ chrome: harness.chrome, core: backgroundCore, getSafeEndpoint: (url) => url });
	await debug.initialize(true, enabled);
	return { debug, harness };
}

test("响应安全投影保留真实模型正文、结束原因和用量，移除未知字段", () => {
	const source = structuredClone(body);
	source.apiKey = "sk-never-store";
	source.choices[0].message.headers = { Authorization: "never-store-header" };
	source.choices[0].message.reasoning_content = "never-store-reasoning";
	const result = createSafeResponsePayload(JSON.stringify(source));
	assert.deepEqual(result.payload, body);
	assert.equal(result.truncated, false);
	assert.deepEqual(result.omittedFields, ["choices.message.other_field", "choices.message.reasoning_content", "other_field"]);
	assert.doesNotMatch(JSON.stringify(result), /never-store|apiKey|headers/u);
	for (const invalid of [null, [], "bad json", "null", {}, { private: "secret" }]) {
		assert.equal(createSafeResponsePayload(invalid), undefined);
	}
});

test("超大响应按 UTF-8 上限保留真实前缀，后续 choices 仍进入快照", () => {
	const text = "很长的译文\n".repeat(50_000);
	const source = structuredClone(body);
	source.choices[0].message.content = text;
	source.choices.push({ index: 1, message: { role: "assistant", content: "第二个返回" }, finish_reason: "length" });
	const result = createSafeResponsePayload(source);
	assert.equal(result.truncated, true);
	assert.ok(estimateStorageBytes(result.payload) <= DEBUG_LIMITS.maxResponsePayloadBytes);
	assert.ok(text.startsWith(result.payload.choices[0].message.content));
	assert.equal(result.payload.choices.length, 2);
	assert.equal(result.payload.choices[1].finish_reason, "length");
	assert.equal(typeof result.payload.choices[1].message.content, "string");
});

test("响应正文按事件及授权保存，重启仍可读取且关闭后清除并广播", async () => {
	const { debug, harness } = await createStore();
	const messages = [];
	const port = {
		name: DEBUG_PORT_NAME, sender: { url: "chrome-extension://test/options" },
		onMessage: { addListener() {} }, onDisconnect: { addListener() {} },
		postMessage: (message) => messages.push(structuredClone(message)), disconnect() {},
	};
	debug.connect(port, () => true);
	debug.record(event());
	debug.record(event({ eventType: "sdk.request-start" }));
	const events = await debug.getEvents();
	assert.deepEqual(events[0].responsePayload, body);
	assert.equal(events[0].responseBody, undefined);
	assert.equal(events[1].responsePayload, undefined);
	const restarted = createDebugStore({ chrome: harness.chrome, core: backgroundCore, getSafeEndpoint: (url) => url });
	await restarted.initialize(true, true);
	assert.deepEqual((await restarted.getEvents())[0].responsePayload, body);
	await debug.setRequestPayloadEnabled(false);
	assert.doesNotMatch(JSON.stringify(await debug.getEvents()), /私密译文/u);
	assert.doesNotMatch(JSON.stringify(harness.session.data[STORAGE_KEYS.debugEvents]), /私密译文/u);
	assert.doesNotMatch(JSON.stringify(messages.at(-1)), /私密译文/u);
	// 在关闭开关之前发出的请求，晚到响应也不得重新保存正文。
	debug.record(event());
	assert.equal((await debug.getEvents()).at(-1).responsePayload, undefined);
});

test("未授权、无痕和其他服务的响应只保留元数据", async () => {
	for (const [enabled, overrides] of [[false, {}], [true, { incognito: true }], [true, { provider: "openai" }], [true, { requestPayloadAllowed: false }]]) {
		const { debug, harness } = await createStore(enabled);
		debug.record(event(overrides));
		assert.equal((await debug.getEvents())[0].responsePayload, undefined);
		assert.doesNotMatch(JSON.stringify(harness.session.data), /私密译文/u);
	}
});

test("HTTP 失败保留 JSON 错误响应，格式错误和截断的生成内容不被改写", async () => {
	const { debug } = await createStore();
	const errorBody = { error: { type: "invalid_request_error", code: "bad_request", message: "请检查请求参数", param: null } };
	debug.record(event({ eventType: "model.request.failed", responseBody: JSON.stringify(errorBody) }));
	for (const [text, reason] of [["invalid json", "stop"], ['{"translations":[', "length"]]) {
		const responseBody = structuredClone(body);
		responseBody.choices[0].message.content = text;
		responseBody.choices[0].finish_reason = reason;
		debug.record(event({ responseBody }));
	}
	const saved = await debug.getEvents();
	assert.deepEqual(saved[0].responsePayload, errorBody);
	assert.equal(saved[1].responsePayload.choices[0].message.content, "invalid json");
	assert.equal(saved[2].responsePayload.choices[0].finish_reason, "length");
});

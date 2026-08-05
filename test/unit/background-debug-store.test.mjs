import assert from "node:assert/strict";
import test from "node:test";

import { DEBUG_LIMITS, STORAGE_KEYS } from "../../chrome-extension/background/constants.js";
import { createDebugStore } from "../../chrome-extension/background/debug-store.js";
import { estimateStorageBytes } from "../../chrome-extension/background/utilities.js";
import { backgroundCore, createChromeHarness } from "../helpers/background-harness.mjs";

function createStore(harness) {
	return createDebugStore({
		chrome: harness.chrome,
		core: backgroundCore,
		getSafeEndpoint: (value) => value,
	});
}

function createDeepSeekRequestEvent(overrides = {}) {
	return {
		provider: "deepseek",
		model: "deepseek-v4-flash",
		eventType: "sdk.request-start",
		requestId: "provider-request-1",
		requestPayloadAllowed: true,
		incognito: false,
		requestBody: JSON.stringify({
			model: "deepseek-v4-flash",
			max_tokens: 100,
			messages: [
				{ role: "system", content: "只返回译文" },
				{ role: "user", content: "网页原文" },
			],
			thinking: { type: "disabled" },
		}),
		...overrides,
	};
}

// 调试关闭时不得写入事件，已排队事件也必须在开关关闭后放弃。
test("调试存储仅在显式启用时记录", async () => {
	const harness = createChromeHarness();
	const debug = createStore(harness);
	await debug.initialize(false);

	debug.record(createDeepSeekRequestEvent());
	assert.deepEqual(await debug.getEvents(), []);

	debug.setEnabled(true);
	debug.record(createDeepSeekRequestEvent());
	debug.setEnabled(false);
	assert.deepEqual(await debug.getEvents(), []);
	assert.equal(harness.session.data[STORAGE_KEYS.debugEvents], undefined);
});

// DeepSeek 请求开始事件只能持久化正文安全投影，凭据、请求头和响应字段必须被丢弃。
test("调试存储只保留 DeepSeek 请求正文白名单", async () => {
	const harness = createChromeHarness();
	const debug = createStore(harness);
	await debug.initialize(true, true);
	const apiKey = "sk-never-store-this";
	const authorization = "Bearer never-store-this";
	const safeBody = {
		model: "deepseek-v4-flash",
		max_tokens: 100,
		messages: [
			{ role: "system", content: "只返回译文", name: "ignored" },
			{ role: "user", content: "网页原文", tool_calls: ["ignored"] },
		],
		thinking: { type: "disabled", budget: 999 },
		apiKey,
		Authorization: authorization,
		headers: { Authorization: authorization },
		responseBody: "响应正文",
	};

	debug.record(createDeepSeekRequestEvent({ requestBody: JSON.stringify(safeBody) }));
	debug.record(createDeepSeekRequestEvent({ provider: "openai" }));
	debug.record(createDeepSeekRequestEvent({ eventType: "sdk.request-end" }));
	const events = await debug.getEvents();

	assert.deepEqual(events[0].requestPayload, {
		model: "deepseek-v4-flash",
		max_tokens: 100,
		thinking: { type: "disabled" },
		messages: [
			{ role: "system", content: "只返回译文" },
			{ role: "user", content: "网页原文" },
		],
	});
	assert.equal(Object.hasOwn(events[1], "requestPayload"), false);
	assert.equal(Object.hasOwn(events[2], "requestPayload"), false);
	const serialized = JSON.stringify({ events, stored: harness.session.data });
	assert.equal(serialized.includes(apiKey), false);
	assert.equal(serialized.includes(authorization), false);
	assert.equal(serialized.includes("responseBody"), false);
	assert.equal(serialized.includes("requestBody"), false);

	const restartedDebug = createStore(harness);
	await restartedDebug.initialize(true, true);
	assert.deepEqual((await restartedDebug.getEvents())[0].requestPayload, events[0].requestPayload);
});

// 正文开关和无痕标志都属于强制边界，任一不满足都只能保留元数据。
test("DeepSeek 正文要求独立授权且禁止无痕持久化", async () => {
	const disabledHarness = createChromeHarness();
	const disabled = createStore(disabledHarness);
	await disabled.initialize(true, false);
	disabled.record(createDeepSeekRequestEvent());
	assert.equal(Object.hasOwn((await disabled.getEvents())[0], "requestPayload"), false);
	assert.doesNotMatch(JSON.stringify(disabledHarness.session.data), /网页原文/u);

	const incognitoHarness = createChromeHarness();
	const incognito = createStore(incognitoHarness);
	await incognito.initialize(true, true);
	incognito.record(createDeepSeekRequestEvent({ incognito: true }));
	assert.equal(Object.hasOwn((await incognito.getEvents())[0], "requestPayload"), false);
	assert.doesNotMatch(JSON.stringify(incognitoHarness.session.data), /网页原文/u);
});

// 撤回正文授权必须在响应前清理内存、session storage 和实时面板快照。
test("关闭正文开关会清除已经保存的请求正文", async () => {
	const harness = createChromeHarness();
	const debug = createStore(harness);
	await debug.initialize(true, true);
	debug.record(createDeepSeekRequestEvent());
	assert.match(JSON.stringify(await debug.getEvents()), /网页原文/u);

	await debug.setRequestPayloadEnabled(false);
	assert.doesNotMatch(JSON.stringify(await debug.getEvents()), /网页原文/u);
	assert.doesNotMatch(JSON.stringify(harness.session.data), /网页原文/u);
});

// 超大网页正文必须按 UTF-8 存储大小截断，并保留明确的截断标记。
test("DeepSeek 请求正文遵守单 payload 大小上限", async () => {
	const harness = createChromeHarness();
	const debug = createStore(harness);
	await debug.initialize(true, true);
	const originalContent = "很长的网页原文".repeat(20_000);
	debug.record(
		createDeepSeekRequestEvent({
			requestBody: JSON.stringify({
				model: "deepseek-v4-flash",
				max_tokens: 8_000,
				messages: [{ role: "user", content: originalContent }],
				thinking: { type: "disabled" },
			}),
		}),
	);

	const [event] = await debug.getEvents();
	assert.equal(event.requestPayloadTruncated, true);
	assert.ok(
		estimateStorageBytes(event.requestPayload) <= DEBUG_LIMITS.maxRequestPayloadBytes,
	);
	assert.ok(event.requestPayload.messages[0].content.length < originalContent.length);
	assert.ok(originalContent.startsWith(event.requestPayload.messages[0].content));
});

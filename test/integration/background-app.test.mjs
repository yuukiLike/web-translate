import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import {
	backgroundCatalog,
	backgroundCore,
	createChromeHarness,
	createConfiguredSettings,
	createExtensionSender,
	createProviderRuntimeFake,
	createWebpageSender,
	sendAppMessage,
} from "../helpers/background-harness.mjs";

function createApp(harness, providerRuntime = createProviderRuntimeFake()) {
	return {
		app: createBackgroundApp({
			chrome: harness.chrome,
			core: backgroundCore,
			providerCatalog: backgroundCatalog,
			providerRuntime,
		}),
		providerRuntime,
	};
}

// 验证入口在启动异步初始化前同步注册全部五类 MV3 监听器，Popup 模式不再注册 action 点击事件。
test("Service Worker 入口同步注册五类监听器", async () => {
	const source = await readFile(
		new URL("../../chrome-extension/background/service-worker.js", import.meta.url),
		"utf8",
	);
	const registrations = [
		"chrome.runtime.onInstalled.addListener(app.onInstalled)",
		"chrome.contextMenus.onClicked.addListener(app.onContextMenuClicked)",
		"chrome.runtime.onMessage.addListener(app.onMessage)",
		"chrome.runtime.onConnect.addListener(app.onConnect)",
		"chrome.tabs.onRemoved.addListener(app.onTabRemoved)",
	];
	const startIndex = source.indexOf("void app.start()");
	assert.ok(startIndex > 0);
	for (const registration of registrations) {
		const registrationIndex = source.indexOf(registration);
		assert.ok(registrationIndex >= 0, `缺少监听器：${registration}`);
		assert.ok(registrationIndex < startIndex, `监听器注册晚于启动：${registration}`);
	}
	assert.doesNotMatch(source, /chrome\.action\.onClicked/u);
	assert.equal(source.match(/\.addListener\(/gu)?.length, 5);
});

// 验证 Popup 新消息只接受扩展页面，并始终查询前台标签后按 CSS、运行时脚本顺序注入。
test("Popup 消息安全查询并切换当前标签页", async () => {
	const harness = createChromeHarness();
	const { app } = createApp(harness);
	await app.start();

	for (const message of [
		{ type: "GET_POPUP_STATE" },
		{ type: "SET_LANGUAGE_PAIR", sourceMode: "zh", targetLanguage: "en" },
		{ type: "TOGGLE_ACTIVE_TAB" },
	]) {
		assert.deepEqual(await sendAppMessage(app, message, createWebpageSender()), {
			ok: false,
			error: "网页脚本无权读取敏感设置",
		});
	}
	assert.deepEqual(harness.tabQueries, []);

	const popupSender = createExtensionSender("popup/index.html");
	const state = await sendAppMessage(app, { type: "GET_POPUP_STATE" }, popupSender);
	assert.equal(state.ok, true);
	assert.equal(state.version, "0.4.0");
	assert.equal(state.popupProtocolVersion, 2);
	assert.equal(state.providerLabel, "DeepSeek");
	assert.equal(state.model, "deepseek-v4-flash");
	assert.deepEqual(state.languagePair, { sourceMode: "auto", targetLanguage: "zh" });
	assert.equal(state.configured, true);
	assert.equal(state.canTranslate, true);
	assert.deepEqual(await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" }, popupSender), {
		ok: true,
		status: "triggered",
	});

	assert.deepEqual(harness.tabQueries, [
		{ active: true, lastFocusedWindow: true },
		{ active: true, lastFocusedWindow: true },
	]);
	assert.deepEqual(harness.scriptExecutions, [
		{
			type: "css",
			details: { target: { tabId: 7 }, files: ["content/content.css"] },
		},
		{
			type: "script",
			details: {
				target: { tabId: 7 },
				files: [
					"generated/provider-catalog.js",
					"generated/core.js",
					"generated/content-script.js",
				],
			},
		},
	]);
});

// 验证 Popup 通过窄接口持久化全部合法语言方向，并拒绝会被规范化掩盖的非法值。
test("Popup 安全读写全部语言方向", async () => {
	const harness = createChromeHarness();
	const { app } = createApp(harness);
	const sender = createExtensionSender("popup/index.html");
	await app.start();

	for (const [sourceMode, targetLanguage] of [
		["auto", "en"],
		["en", "zh"],
		["zh", "en"],
		["auto", "zh"],
	]) {
		const languagePair = { sourceMode, targetLanguage };
		const response = await sendAppMessage(
			app,
			{ type: "SET_LANGUAGE_PAIR", ...languagePair },
			sender,
		);
		assert.deepEqual(response, { ok: true, popupProtocolVersion: 2, languagePair });
		const state = await sendAppMessage(app, { type: "GET_POPUP_STATE" }, sender);
		assert.deepEqual(state.languagePair, languagePair);
	}
	assert.equal(harness.local.data[backgroundCore.SETTINGS_KEY].deepseek.apiKey, "sk-background-test");
	assert.deepEqual(
		await sendAppMessage(
			app,
			{ type: "SET_LANGUAGE_PAIR", sourceMode: "zh", targetLanguage: "zh" },
			sender,
		),
		{ ok: false, error: "翻译语言组合无效" },
	);
});

// 验证从启动任务、翻译、缓存命中、状态完成到取消的完整后台消息主链。
test("后台应用完成翻译任务主消息链", async () => {
	const settings = createConfiguredSettings();
	const harness = createChromeHarness({ settings });
	const { app, providerRuntime } = createApp(harness);
	await app.start();
	const sender = createWebpageSender();

	const started = await sendAppMessage(app, { type: "START_RUN", runId: "run-main" }, sender);
	assert.deepEqual(started, {
		ok: true,
		settings: backgroundCore.publicSettings(settings),
	});
	assert.ok(!JSON.stringify(started).includes("sk-background-test"));
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-main",
		state: "active",
	});

	const firstRequest = {
		type: "TRANSLATE_BATCH",
		runId: "run-main",
		sourceLanguage: "en",
		targetLanguage: "zh",
		segments: [
			{ id: "hello", text: "hello" },
			{ id: "world", text: "world" },
		],
	};
	assert.deepEqual(await sendAppMessage(app, firstRequest, sender), {
		ok: true,
		results: [
			{ id: "hello", text: "译文：hello" },
			{ id: "world", text: "译文：world" },
		],
		cacheHits: 0,
	});
	assert.equal(providerRuntime.requests.length, 1);

	const fullHit = await sendAppMessage(app, firstRequest, sender);
	assert.equal(fullHit.cacheHits, 2);
	assert.equal(providerRuntime.requests.length, 1);
	const mixedHit = await sendAppMessage(
		app,
		{
			...firstRequest,
			segments: [
				{ id: "world", text: "world" },
				{ id: "fresh", text: "fresh" },
			],
		},
		sender,
	);
	assert.deepEqual(mixedHit.results, [
		{ id: "world", text: "译文：world" },
		{ id: "fresh", text: "译文：fresh" },
	]);
	assert.equal(mixedHit.cacheHits, 1);
	assert.equal(providerRuntime.requests.length, 2);

	await sendAppMessage(
		app,
		{ type: "STATUS", runId: "run-main", state: "working", completed: 1, total: 2 },
		sender,
	);
	assert.equal(harness.badgeTexts.at(-1), "50");
	const doneStartedAt = Date.now();
	await sendAppMessage(app, { type: "STATUS", runId: "run-main", state: "done" }, sender);
	assert.ok(Date.now() - doneStartedAt >= 300);
	assert.equal(harness.badgeTexts.at(-1), "OK");

	assert.deepEqual(
		await sendAppMessage(app, { type: "CANCEL_RUN", runId: "run-main" }, sender),
		{ ok: true },
	);
	assert.equal(harness.badgeTexts.at(-1), "");
	assert.equal(harness.session.data["run-snapshot:7:run-main"], undefined);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-main",
		state: "cancelled",
	});
});

// 验证已删除的独立缓存消息不会重新成为可调用的后台接口。
test("旧缓存消息接口返回未知消息", async () => {
	const harness = createChromeHarness();
	const { app } = createApp(harness);
	await app.start();
	const sender = createWebpageSender();

	for (const type of ["CACHE_LOOKUP", "CACHE_STORE"]) {
		assert.deepEqual(await sendAppMessage(app, { type }, sender), {
			ok: false,
			error: "未知消息类型",
		});
	}
});

// 验证网页发送的敏感设置写入会在解析前被拒绝，原凭据保持不变。
test("普通网页不能修改敏感设置", async () => {
	const settings = createConfiguredSettings();
	const harness = createChromeHarness({ settings });
	const { app } = createApp(harness);
	await app.start();

	const response = await sendAppMessage(
		app,
		{ type: "SAVE_SETTINGS", settings: null },
		createWebpageSender(),
	);
	assert.deepEqual(response, { ok: false, error: "网页脚本无权读取敏感设置" });
	assert.equal(
		harness.local.data[backgroundCore.SETTINGS_KEY].deepseek.apiKey,
		"sk-background-test",
	);
});

// 验证 Service Worker 重启后只有持久化 current run 能更新 Badge，旧快照已被清理。
test("后台重启后忽略旧任务状态", async () => {
	const harness = createChromeHarness();
	const firstWorker = createApp(harness).app;
	await firstWorker.start();
	const sender = createWebpageSender();
	await sendAppMessage(firstWorker, { type: "START_RUN", runId: "run-old" }, sender);
	await sendAppMessage(firstWorker, { type: "START_RUN", runId: "run-new" }, sender);
	assert.equal(harness.session.data["run-snapshot:7:run-old"], undefined);
	assert.ok(harness.session.data["run-snapshot:7:run-new"]);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-new",
		state: "active",
	});

	const restartedWorker = createApp(harness).app;
	await restartedWorker.start();
	const badgeCount = harness.badgeTexts.length;
	assert.deepEqual(
		await sendAppMessage(
			restartedWorker,
			{ type: "STATUS", runId: "run-old", state: "working", completed: 1, total: 2 },
			sender,
		),
		{ ok: true, ignored: true },
	);
	assert.equal(harness.badgeTexts.length, badgeCount);

	assert.deepEqual(
		await sendAppMessage(
			restartedWorker,
			{ type: "STATUS", runId: "run-new", state: "working", completed: 1, total: 2 },
			sender,
		),
		{ ok: true },
	);
	assert.equal(harness.badgeTexts.at(-1), "50");
});

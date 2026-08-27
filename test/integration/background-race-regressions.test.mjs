import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import {
	backgroundCatalog,
	backgroundCore,
	createChromeHarness,
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

function createBatch(runId) {
	return {
		type: "TRANSLATE_BATCH",
		runId,
		sourceLanguage: "en",
		targetLanguage: "zh",
		segments: [{ id: "late", text: "late private source" }],
	};
}

// 验证持久清理尚未完成时，cancelled 终态会让清理前后所有迟到状态都失效。
test("持久清理阻塞时迟到状态不能恢复 Badge", async () => {
	const harness = createChromeHarness();
	const { app } = createApp(harness);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-status-race" }, sender);

	const removeEntered = Promise.withResolvers();
	const releaseRemove = Promise.withResolvers();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-status-race") {
			removeEntered.resolve();
			await releaseRemove.promise;
		}
		await originalRemove(keys);
	};

	const cancelling = sendAppMessage(
		app,
		{ type: "CANCEL_RUN", runId: "run-status-race" },
		sender,
	);
	await removeEntered.promise;
	assert.deepEqual(await cancelling, { ok: true });
	const badgeCount = harness.badgeTexts.length;
	assert.deepEqual(
		await sendAppMessage(
			app,
			{ type: "STATUS", runId: "run-status-race", state: "working", completed: 1, total: 2 },
			sender,
		),
		{ ok: true, ignored: true },
	);
	assert.equal(harness.badgeTexts.length, badgeCount);

	releaseRemove.resolve();
	assert.equal(
		(
			await sendAppMessage(
				app,
				{
					type: "STATUS",
					runId: "run-status-race",
					state: "working",
					completed: 1,
					total: 4,
				},
				sender,
			)
		).ignored,
		true,
	);
	assert.equal(harness.badgeTexts.length, badgeCount);
});

// 验证标签页关闭清理即使卡在存储读取，已排队的旧批次也不能从 session 复活。
test("标签页关闭立即阻止迟到批次", async () => {
	const harness = createChromeHarness();
	const { app, providerRuntime } = createApp(harness);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-closed-tab" }, sender);

	const cleanupEntered = Promise.withResolvers();
	const releaseCleanup = Promise.withResolvers();
	const originalGet = harness.session.get.bind(harness.session);
	harness.session.get = async (keys) => {
		if (keys === null) {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		return await originalGet(keys);
	};
	app.onTabRemoved(7);
	await cleanupEntered.promise;

	assert.deepEqual(await sendAppMessage(app, createBatch("run-closed-tab"), sender), {
		ok: false,
		error: "标签页已关闭",
	});
	assert.equal(
		(
			await sendAppMessage(
				app,
				{
					type: "STATUS",
					runId: "run-closed-tab",
					state: "working",
					completed: 1,
					total: 2,
				},
				sender,
			)
		).ignored,
		true,
	);
	assert.equal(providerRuntime.requests.length, 0);
	releaseCleanup.resolve();
});

// 验证旧快照回收即使长时间阻塞，新任务仍可完成启动并立即处理翻译批次。
test("旧快照回收阻塞不会阻塞新任务", async () => {
	const harness = createChromeHarness();
	const { app, providerRuntime } = createApp(harness);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-a" }, sender);

	const cleanupEntered = Promise.withResolvers();
	const releaseCleanup = Promise.withResolvers();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-a") {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		await originalRemove(keys);
	};
	const starting = sendAppMessage(app, { type: "START_RUN", runId: "run-b" }, sender);
	await cleanupEntered.promise;

	assert.equal((await starting).ok, true);
	assert.equal((await sendAppMessage(app, createBatch("run-b"), sender)).ok, true);
	assert.equal(providerRuntime.requests.length, 1);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-b",
		state: "active",
	});
	releaseCleanup.resolve();
});

// 验证旧快照回收失败只是维护故障，已经提交的新任务仍保持消息与状态一致。
test("旧快照回收失败不会制造幽灵任务", async () => {
	const harness = createChromeHarness();
	const { app, providerRuntime } = createApp(harness);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-a" }, sender);

	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-a") {
			throw new Error("模拟旧快照回收失败");
		}
		await originalRemove(keys);
	};
	assert.equal(
		(await sendAppMessage(app, { type: "START_RUN", runId: "run-b" }, sender)).ok,
		true,
	);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-b",
		state: "active",
	});
	assert.equal((await sendAppMessage(app, createBatch("run-b"), sender)).ok, true);
	assert.equal(providerRuntime.requests.length, 1);
});

// 验证已提交启动在维护清理期间遇到更新但失败的启动时，仍作为最后成功任务完成注册。
test("较新的失败启动不会破坏已提交任务", async () => {
	const harness = createChromeHarness();
	const { app } = createApp(harness);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-a" }, sender);

	const cleanupEntered = Promise.withResolvers();
	const releaseCleanup = Promise.withResolvers();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-a") {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		await originalRemove(keys);
	};
	const startB = sendAppMessage(app, { type: "START_RUN", runId: "run-b" }, sender);
	await cleanupEntered.promise;

	const originalGet = harness.local.get.bind(harness.local);
	let rejectNextSettingsRead = true;
	harness.local.get = async (keys) => {
		if (keys === backgroundCore.SETTINGS_KEY && rejectNextSettingsRead) {
			rejectNextSettingsRead = false;
			throw new Error("模拟设置读取失败");
		}
		return await originalGet(keys);
	};
	assert.deepEqual(
		await sendAppMessage(app, { type: "START_RUN", runId: "run-c" }, sender),
		{ ok: false, error: "模拟设置读取失败" },
	);
	releaseCleanup.resolve();

	assert.equal((await startB).ok, true);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-b",
		state: "active",
	});
	assert.equal(
		(
			await sendAppMessage(
				app,
				{ type: "STATUS", runId: "run-b", state: "working", completed: 1, total: 2 },
				sender,
			)
		).ok,
		true,
	);
});

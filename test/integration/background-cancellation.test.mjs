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

function createApp(harness, providerRuntime) {
	return createBackgroundApp({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		providerRuntime,
	});
}

// 验证取消覆盖缓存读取阶段，释放阻塞后也不能再上传正文、计费或写入译文缓存。
test("缓存读取期间取消不会继续调用 Provider", async () => {
	const harness = createChromeHarness();
	const providerRuntime = createProviderRuntimeFake();
	const app = createApp(harness, providerRuntime);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-cache-cancel" }, sender);

	const cacheEntered = Promise.withResolvers();
	const releaseCache = Promise.withResolvers();
	const originalGet = harness.local.get.bind(harness.local);
	harness.local.get = async (keys) => {
		if (
			Array.isArray(keys) &&
			keys.some((key) => key.startsWith(backgroundCore.CACHE_PREFIX))
		) {
			cacheEntered.resolve();
			await releaseCache.promise;
		}
		return await originalGet(keys);
	};

	const batch = sendAppMessage(
		app,
		{
			type: "TRANSLATE_BATCH",
			runId: "run-cache-cancel",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "segment-1", text: "sensitive source text" }],
		},
		sender,
	);
	await cacheEntered.promise;
	assert.deepEqual(
		await sendAppMessage(
			app,
			{ type: "CANCEL_RUN", runId: "run-cache-cancel" },
			sender,
		),
		{ ok: true },
	);
	releaseCache.resolve();

	assert.deepEqual(await batch, { ok: false, error: "翻译已取消" });
	assert.equal(providerRuntime.requests.length, 0);
	assert.equal(
		Object.keys(harness.local.data).some((key) =>
			key.startsWith(backgroundCore.CACHE_PREFIX),
		),
		false,
	);
});

// 验证启动尚未读完设置时收到取消，迟到的启动不能重新成为当前任务或留下快照。
test("启动过程中取消不会留下幽灵任务", async () => {
	const harness = createChromeHarness();
	const providerRuntime = createProviderRuntimeFake();
	const app = createApp(harness, providerRuntime);
	const sender = createWebpageSender();
	await app.start();

	const settingsEntered = Promise.withResolvers();
	const releaseSettings = Promise.withResolvers();
	const originalGet = harness.local.get.bind(harness.local);
	harness.local.get = async (keys) => {
		if (keys === backgroundCore.SETTINGS_KEY) {
			settingsEntered.resolve();
			await releaseSettings.promise;
		}
		return await originalGet(keys);
	};

	const starting = sendAppMessage(
		app,
		{ type: "START_RUN", runId: "run-fast-stop" },
		sender,
	);
	await settingsEntered.promise;
	assert.deepEqual(
		await sendAppMessage(app, { type: "CANCEL_RUN", runId: "run-fast-stop" }, sender),
		{ ok: true },
	);
	releaseSettings.resolve();

	assert.deepEqual(await starting, { ok: false, error: "翻译已取消" });
	assert.equal(harness.session.data["current-run:7"], undefined);
	assert.equal(harness.session.data["run-snapshot:7:run-fast-stop"], undefined);
});

// 验证新任务成为当前任务后，旧内容脚本即使迟到也不能再触发 Provider 请求。
test("被新任务取代的旧任务不能继续翻译", async () => {
	const harness = createChromeHarness();
	const providerRuntime = createProviderRuntimeFake();
	const app = createApp(harness, providerRuntime);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-old" }, sender);
	await sendAppMessage(app, { type: "START_RUN", runId: "run-new" }, sender);

	assert.deepEqual(
		await sendAppMessage(
			app,
			{
				type: "TRANSLATE_BATCH",
				runId: "run-old",
				sourceLanguage: "en",
				targetLanguage: "zh",
				segments: [{ id: "late", text: "late source text" }],
			},
			sender,
		),
		{ ok: false, error: "翻译任务已失效，请重新点击扩展图标" },
	);
	assert.equal(providerRuntime.requests.length, 0);
});

// 验证两个启动反序完成时以消息到达顺序为准，较旧启动不能覆盖已经生效的新任务。
test("反序完成的旧启动不能覆盖新任务", async () => {
	const harness = createChromeHarness();
	const providerRuntime = createProviderRuntimeFake();
	const app = createApp(harness, providerRuntime);
	const sender = createWebpageSender();
	await app.start();

	const oldSettingsEntered = Promise.withResolvers();
	const releaseOldSettings = Promise.withResolvers();
	const originalGet = harness.local.get.bind(harness.local);
	let settingsReadCount = 0;
	harness.local.get = async (keys) => {
		if (keys === backgroundCore.SETTINGS_KEY) {
			settingsReadCount += 1;
			if (settingsReadCount === 1) {
				oldSettingsEntered.resolve();
				await releaseOldSettings.promise;
			}
		}
		return await originalGet(keys);
	};

	const oldStart = sendAppMessage(app, { type: "START_RUN", runId: "run-old" }, sender);
	await oldSettingsEntered.promise;
	assert.equal(
		(await sendAppMessage(app, { type: "START_RUN", runId: "run-new" }, sender)).ok,
		true,
	);
	releaseOldSettings.resolve();

	assert.deepEqual(await oldStart, {
		ok: false,
		error: "翻译启动已被较新的任务取代",
	});
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-new",
		state: "active",
	});
	assert.equal(harness.session.data["run-snapshot:7:run-old"], undefined);
	assert.ok(harness.session.data["run-snapshot:7:run-new"]);
});

// 验证 Badge 清理阻塞时持久任务已先失效，后台重启也不能恢复已取消任务继续上传正文。
test("取消不等待 Badge 即持久失效", async () => {
	const harness = createChromeHarness();
	const providerRuntime = createProviderRuntimeFake();
	const app = createApp(harness, providerRuntime);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-badge-blocked" }, sender);

	const badgeEntered = Promise.withResolvers();
	const releaseBadge = Promise.withResolvers();
	const originalSetBadgeText = harness.chrome.action.setBadgeText.bind(
		harness.chrome.action,
	);
	harness.chrome.action.setBadgeText = async (details) => {
		await originalSetBadgeText(details);
		if (details.text === "") {
			badgeEntered.resolve();
			await releaseBadge.promise;
		}
	};

	const cancelling = sendAppMessage(
		app,
		{ type: "CANCEL_RUN", runId: "run-badge-blocked" },
		sender,
	);
	await badgeEntered.promise;
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-badge-blocked",
		state: "cancelled",
	});
	assert.equal(harness.session.data["run-snapshot:7:run-badge-blocked"], undefined);

	const restartedRuntime = createProviderRuntimeFake();
	const restartedApp = createApp(harness, restartedRuntime);
	await restartedApp.start();
	const lateBatch = await sendAppMessage(
		restartedApp,
		{
			type: "TRANSLATE_BATCH",
			runId: "run-badge-blocked",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "late", text: "late private text" }],
		},
		sender,
	);
	assert.equal(lateBatch.ok, false);
	assert.equal(restartedRuntime.requests.length, 0);

	releaseBadge.resolve();
	assert.deepEqual(await cancelling, { ok: true });
});

// 验证快照回收永久挂起时，取消响应和下一次启动仍只依赖已落盘的 cancelled 终态。
test("快照回收挂起不会锁死翻译开关", async () => {
	const harness = createChromeHarness();
	const providerRuntime = createProviderRuntimeFake();
	const app = createApp(harness, providerRuntime);
	const sender = createWebpageSender();
	await app.start();
	await sendAppMessage(app, { type: "START_RUN", runId: "run-cleanup-stuck" }, sender);

	const cleanupEntered = Promise.withResolvers();
	const releaseCleanup = Promise.withResolvers();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-cleanup-stuck") {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		await originalRemove(keys);
	};

	const cancelling = sendAppMessage(
		app,
		{ type: "CANCEL_RUN", runId: "run-cleanup-stuck" },
		sender,
	);
	await cleanupEntered.promise;
	let timeoutId;
	const outcome = await Promise.race([
		cancelling,
		new Promise((resolve) => {
			timeoutId = setTimeout(() => resolve("timeout"), 200);
		}),
	]);
	clearTimeout(timeoutId);
	assert.deepEqual(outcome, { ok: true });
	assert.equal(
		(await sendAppMessage(app, { type: "START_RUN", runId: "run-after-cleanup" }, sender)).ok,
		true,
	);

	releaseCleanup.resolve();
});

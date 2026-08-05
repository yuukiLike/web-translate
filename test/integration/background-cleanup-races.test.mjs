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

function createDeferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createApp(harness) {
	const providerRuntime = createProviderRuntimeFake();
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

function failCancelledMarker(harness) {
	const originalSet = harness.session.set.bind(harness.session);
	harness.session.set = async (values) => {
		if (values["current-run:7"]?.state === "cancelled") {
			throw new Error("模拟 cancelled 写入失败");
		}
		await originalSet(values);
	};
}

// 验证持久化回退中尚未完成的快照删除会被登记，同 runId 不能在旧删除结束前复用。
test("取消回退的慢快照删除会阻止同 runId 复用", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const running = createApp(harness);
	await running.app.start();
	const runId = "run-fallback-cleanup";
	const snapshotKey = `run-snapshot:7:${runId}`;
	await sendAppMessage(running.app, { type: "START_RUN", runId }, sender);
	failCancelledMarker(harness);

	const firstDeleteEntered = createDeferred();
	const firstDeleteFinished = createDeferred();
	const releaseFirstDelete = createDeferred();
	const originalRemove = harness.session.remove.bind(harness.session);
	let snapshotDeleteCount = 0;
	harness.session.remove = async (keys) => {
		let isFirstSnapshotDelete = false;
		if (keys === snapshotKey) {
			snapshotDeleteCount += 1;
			isFirstSnapshotDelete = snapshotDeleteCount === 1;
			if (isFirstSnapshotDelete) {
				firstDeleteEntered.resolve();
				await releaseFirstDelete.promise;
			}
		}
		await originalRemove(keys);
		if (isFirstSnapshotDelete) firstDeleteFinished.resolve();
	};

	const cancelling = sendAppMessage(running.app, { type: "CANCEL_RUN", runId }, sender);
	await firstDeleteEntered.promise;
	assert.deepEqual(await cancelling, { ok: true });
	assert.deepEqual(
		await sendAppMessage(running.app, { type: "START_RUN", runId }, sender),
		{ ok: false, error: "相同翻译任务仍在清理，请重试" },
	);

	releaseFirstDelete.resolve();
	await firstDeleteFinished.promise;
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		(await sendAppMessage(running.app, { type: "START_RUN", runId }, sender)).ok,
		true,
	);
	assert.ok(harness.session.data[snapshotKey]);
});

// 验证快照删除先完成时，慢 current 删除会建立 tab 屏障，不能在新任务提交后误删其权威指针。
test("取消回退的慢 current 删除会阻止新任务提前提交", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const running = createApp(harness);
	await running.app.start();
	await sendAppMessage(running.app, { type: "START_RUN", runId: "run-old" }, sender);
	failCancelledMarker(harness);

	const currentDeleteEntered = createDeferred();
	const currentDeleteFinished = createDeferred();
	const releaseCurrentDelete = createDeferred();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "current-run:7") {
			currentDeleteEntered.resolve();
			await releaseCurrentDelete.promise;
		}
		await originalRemove(keys);
		if (keys === "current-run:7") currentDeleteFinished.resolve();
	};

	const cancelling = sendAppMessage(
		running.app,
		{ type: "CANCEL_RUN", runId: "run-old" },
		sender,
	);
	await currentDeleteEntered.promise;
	assert.deepEqual(await cancelling, { ok: true });
	assert.deepEqual(
		await sendAppMessage(running.app, { type: "START_RUN", runId: "run-new" }, sender),
		{ ok: false, error: "标签页任务仍在清理，请重试" },
	);

	releaseCurrentDelete.resolve();
	await currentDeleteFinished.promise;
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		(await sendAppMessage(running.app, { type: "START_RUN", runId: "run-new" }, sender)).ok,
		true,
	);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-new",
		state: "active",
	});

	const restarted = createApp(harness);
	await restarted.app.start();
	const translated = await sendAppMessage(
		restarted.app,
		{
			type: "TRANSLATE_BATCH",
			runId: "run-new",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "survives", text: "new current pointer survives" }],
		},
		sender,
	);
	assert.equal(translated.ok, true, translated.error);
	assert.equal(restarted.providerRuntime.requests.length, 1);
});

// 验证关闭标签页的慢清理分支结束前不会释放 tab 屏障，避免复用 tabId 的新快照被误删。
test("关闭标签页的慢快照清理会阻止 tabId 提前复用", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const running = createApp(harness);
	await running.app.start();
	const runId = "run-tab-cleanup";
	const snapshotKey = `run-snapshot:7:${runId}`;
	await sendAppMessage(running.app, { type: "START_RUN", runId }, sender);
	failCancelledMarker(harness);

	const cleanupEntered = createDeferred();
	const cleanupFinished = createDeferred();
	const releaseCleanup = createDeferred();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (Array.isArray(keys) && keys.includes(snapshotKey)) {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		await originalRemove(keys);
		if (Array.isArray(keys) && keys.includes(snapshotKey)) cleanupFinished.resolve();
	};

	running.app.onTabRemoved(7);
	await cleanupEntered.promise;
	assert.deepEqual(
		await sendAppMessage(running.app, { type: "START_RUN", runId }, sender),
		{ ok: false, error: "标签页已关闭" },
	);

	releaseCleanup.resolve();
	await cleanupFinished.promise;
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		(await sendAppMessage(running.app, { type: "START_RUN", runId }, sender)).ok,
		true,
	);
	assert.ok(harness.session.data[snapshotKey]);
});

// 验证无 current 标签页启动的广域清理结束前仍保留 tab 屏障，不能删除随后复用 tabId 的任务。
test("无 current 标签页的慢广域清理会阻止 tabId 提前复用", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const running = createApp(harness);
	await running.app.start();
	const cleanupEntered = createDeferred();
	const cleanupFinished = createDeferred();
	const releaseCleanup = createDeferred();
	const originalGet = harness.session.get.bind(harness.session);
	harness.session.get = async (keys) => {
		if (keys === null) {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		return await originalGet(keys);
	};
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		await originalRemove(keys);
		if (keys === "current-run:7") cleanupFinished.resolve();
	};

	running.app.onTabRemoved(7);
	await cleanupEntered.promise;
	assert.deepEqual(
		await sendAppMessage(running.app, { type: "START_RUN", runId: "run-reused-tab" }, sender),
		{ ok: false, error: "标签页已关闭" },
	);

	releaseCleanup.resolve();
	await cleanupFinished.promise;
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		(
			await sendAppMessage(
				running.app,
				{ type: "START_RUN", runId: "run-reused-tab" },
				sender,
			)
		).ok,
		true,
	);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-reused-tab",
		state: "active",
	});
});

// 验证已有任务收到并发重复 START 时不会覆盖后再删除同键快照，重启后原任务仍可继续。
test("并发重复 START 不会破坏原任务快照", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const first = createApp(harness);
	await first.app.start();
	const runId = "run-existing";
	const snapshotKey = `run-snapshot:7:${runId}`;
	await sendAppMessage(first.app, { type: "START_RUN", runId }, sender);

	const [left, right] = await Promise.all([
		sendAppMessage(first.app, { type: "START_RUN", runId }, sender),
		sendAppMessage(first.app, { type: "START_RUN", runId }, sender),
	]);
	assert.equal(left.ok, false);
	assert.equal(right.ok, false);
	assert.ok(harness.session.data[snapshotKey]);

	const restarted = createApp(harness);
	await restarted.app.start();
	const translated = await sendAppMessage(
		restarted.app,
		{
			type: "TRANSLATE_BATCH",
			runId,
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "still-valid", text: "original snapshot remains valid" }],
		},
		sender,
	);
	assert.equal(translated.ok, true, translated.error);
	assert.equal(restarted.providerRuntime.requests.length, 1);
});

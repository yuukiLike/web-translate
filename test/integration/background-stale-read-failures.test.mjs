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

function createBatch(runId) {
	return {
		type: "TRANSLATE_BATCH",
		runId,
		sourceLanguage: "en",
		targetLanguage: "zh",
		segments: [{ id: "late", text: "captured before cancellation" }],
	};
}

function captureSnapshotRead(harness, snapshotKey) {
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	const originalGet = harness.session.get.bind(harness.session);
	harness.session.get = async (keys) => {
		const stored = await originalGet(keys);
		if (keys === snapshotKey) {
			entered.resolve();
			await release.promise;
		}
		return stored;
	};
	return { entered, release };
}

function failCurrentInvalidation(harness, snapshotKey, onSnapshotRemoved = () => {}) {
	const originalSet = harness.session.set.bind(harness.session);
	harness.session.set = async (values) => {
		if (values["current-run:7"]?.state === "cancelled") {
			throw new Error("模拟 cancelled 写入失败");
		}
		await originalSet(values);
	};
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "current-run:7") {
			throw new Error("模拟 current 删除失败");
		}
		await originalRemove(keys);
		if (keys === snapshotKey || (Array.isArray(keys) && keys.includes(snapshotKey))) {
			onSnapshotRemoved();
		}
	};
}

// 验证批次已捕获旧快照时，即使取消只能删除快照，当前 Worker 的内存终态仍会阻止正文上传。
test("取消仅删除快照时仍封锁已读到快照的批次", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const starter = createApp(harness);
	await starter.app.start();
	const runId = "run-stale-cancel";
	const snapshotKey = `run-snapshot:7:${runId}`;
	await sendAppMessage(starter.app, { type: "START_RUN", runId }, sender);
	const running = createApp(harness);
	await running.app.start();
	const snapshotRead = captureSnapshotRead(harness, snapshotKey);
	failCurrentInvalidation(harness, snapshotKey);

	const batch = sendAppMessage(running.app, createBatch(runId), sender);
	await snapshotRead.entered.promise;
	assert.deepEqual(
		await sendAppMessage(running.app, { type: "CANCEL_RUN", runId }, sender),
		{ ok: true },
	);
	assert.equal(harness.session.data["current-run:7"].state, "active");
	assert.equal(harness.session.data[snapshotKey], undefined);

	snapshotRead.release.resolve();
	assert.equal((await batch).ok, false);
	assert.equal(running.providerRuntime.requests.length, 0);
});

// 验证关闭标签页只能删除快照时，removed-tab 内存屏障不会提前释放已捕获快照的批次。
test("关闭标签页仅删除快照时仍封锁已读到快照的批次", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const starter = createApp(harness);
	await starter.app.start();
	const runId = "run-stale-tab";
	const snapshotKey = `run-snapshot:7:${runId}`;
	await sendAppMessage(starter.app, { type: "START_RUN", runId }, sender);
	const running = createApp(harness);
	await running.app.start();
	const snapshotRead = captureSnapshotRead(harness, snapshotKey);
	const snapshotRemoved = Promise.withResolvers();
	failCurrentInvalidation(harness, snapshotKey, snapshotRemoved.resolve);

	const batch = sendAppMessage(running.app, createBatch(runId), sender);
	await snapshotRead.entered.promise;
	running.app.onTabRemoved(7);
	await snapshotRemoved.promise;
	assert.equal(harness.session.data["current-run:7"].state, "active");
	assert.equal(harness.session.data[snapshotKey], undefined);

	snapshotRead.release.resolve();
	assert.equal((await batch).ok, false);
	assert.equal(running.providerRuntime.requests.length, 0);
});

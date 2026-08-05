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

async function settleWithin(promise, milliseconds = 200) {
	let timeoutId;
	try {
		return await Promise.race([
			promise,
			new Promise((resolve) => {
				timeoutId = setTimeout(() => resolve("timeout"), milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timeoutId);
	}
}

// 验证 cancelled 写入失败且 current 删除也失败时，删除快照这一道防线仍阻止重启上传正文。
test("取消终态写入失败会回退到删除任务权威数据", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const first = createApp(harness);
	await first.app.start();
	await sendAppMessage(first.app, { type: "START_RUN", runId: "run-cancel-fallback" }, sender);

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
	};

	assert.deepEqual(
		await sendAppMessage(first.app, { type: "CANCEL_RUN", runId: "run-cancel-fallback" }, sender),
		{ ok: true },
	);
	assert.equal(harness.session.data["current-run:7"].state, "active");
	assert.equal(harness.session.data["run-snapshot:7:run-cancel-fallback"], undefined);

	const restarted = createApp(harness);
	await restarted.app.start();
	assert.equal(
		(await sendAppMessage(restarted.app, createBatch("run-cancel-fallback"), sender)).ok,
		false,
	);
	assert.equal(restarted.providerRuntime.requests.length, 0);
});

// 验证标签页 cancelled 写入失败且快照清理失败时，删除 current 指针仍使重启后的旧批次失效。
test("标签页终态写入失败会回退到删除 current 指针", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const first = createApp(harness);
	await first.app.start();
	await sendAppMessage(first.app, { type: "START_RUN", runId: "run-tab-fallback" }, sender);

	const originalSet = harness.session.set.bind(harness.session);
	harness.session.set = async (values) => {
		if (values["current-run:7"]?.state === "cancelled") {
			throw new Error("模拟标签页终态写入失败");
		}
		await originalSet(values);
	};
	const currentRemoved = createDeferred();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (Array.isArray(keys) && keys.includes("run-snapshot:7:run-tab-fallback")) {
			throw new Error("模拟标签页快照清理失败");
		}
		await originalRemove(keys);
		if (keys === "current-run:7") currentRemoved.resolve();
	};

	first.app.onTabRemoved(7);
	await currentRemoved.promise;
	assert.equal(harness.session.data["current-run:7"], undefined);
	assert.ok(harness.session.data["run-snapshot:7:run-tab-fallback"]);

	const restarted = createApp(harness);
	await restarted.app.start();
	assert.equal(
		(await sendAppMessage(restarted.app, createBatch("run-tab-fallback"), sender)).ok,
		false,
	);
	assert.equal(restarted.providerRuntime.requests.length, 0);
});

// 验证 Badge API 永久挂起时，取消响应、新任务启动和新进度都不被非关键 UI I/O 锁死。
test("Badge 写入挂起不会锁死翻译生命周期", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const first = createApp(harness);
	await first.app.start();
	await sendAppMessage(first.app, { type: "START_RUN", runId: "run-badge-hang" }, sender);

	const badgeEntered = createDeferred();
	const releaseBadge = createDeferred();
	const originalBadgeWrite = harness.chrome.action.setBadgeText.bind(harness.chrome.action);
	harness.chrome.action.setBadgeText = async (details) => {
		await originalBadgeWrite(details);
		if (details.text === "") {
			badgeEntered.resolve();
			await releaseBadge.promise;
		}
	};

	const cancelling = sendAppMessage(
		first.app,
		{ type: "CANCEL_RUN", runId: "run-badge-hang" },
		sender,
	);
	await badgeEntered.promise;
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-badge-hang",
		state: "cancelled",
	});
	assert.deepEqual(await settleWithin(cancelling), { ok: true });
	assert.equal(
		(await sendAppMessage(first.app, { type: "START_RUN", runId: "run-after-badge" }, sender)).ok,
		true,
	);
	assert.equal(
		(
			await sendAppMessage(
				first.app,
				{ type: "STATUS", runId: "run-after-badge", state: "working", completed: 1, total: 2 },
				sender,
			)
		).ok,
		true,
	);
	releaseBadge.resolve();
});

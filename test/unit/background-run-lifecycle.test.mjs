import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import { createRunStore } from "../../chrome-extension/background/run-store.js";
import {
	backgroundCatalog,
	backgroundCore,
	createChromeHarness,
	createConfiguredSettings,
	createProviderRuntimeFake,
	createWebpageSender,
	sendAppMessage,
} from "../helpers/background-harness.mjs";

function createSnapshot() {
	return {
		settings: createConfiguredSettings(),
		cacheGeneration: 0,
		cacheScope: "https://page.example",
	};
}

async function commitRun(runStore, tabId, runId) {
	const token = runStore.beginStart(tabId, runId);
	try {
		await runStore.saveSnapshot(tabId, runId, createSnapshot(), token);
		runStore.confirmStart(tabId, runId, token);
	} finally {
		runStore.finishStart(token);
	}
}

// 验证超过旧墓碑上限的并发启动取消仍由各自 token 记忆，最早任务不会因第 501 次取消复活。
test("第 501 次取消不会淘汰仍在等待的启动", async () => {
	const harness = createChromeHarness();
	const runStore = createRunStore({ chrome: harness.chrome, core: backgroundCore });
	const tokens = [];
	for (let index = 0; index <= 500; index += 1) {
		const tabId = index + 1;
		const runId = `run-${index}`;
		const token = runStore.beginStart(tabId, runId);
		tokens.push(token);
		runStore.requestCancel(tabId, runId);
	}

	await assert.rejects(
		runStore.saveSnapshot(1, "run-0", createSnapshot(), tokens[0]),
		/翻译已取消/u,
	);
	for (const token of tokens) {
		runStore.finishStart(token);
	}
	assert.equal(harness.session.data["current-run:1"], undefined);
});

// 验证快照删除失败不会让 CANCEL_RUN 失败，重启后默认查询也不会恢复 cancelled 任务。
test("快照删除失败时取消终态仍可跨重启生效", async () => {
	const harness = createChromeHarness();
	const firstWorker = createBackgroundApp({
		chrome: harness.chrome,
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		providerRuntime: createProviderRuntimeFake(),
	});
	const sender = createWebpageSender();
	await firstWorker.start();
	await sendAppMessage(
		firstWorker,
		{ type: "START_RUN", runId: "run-delete-failed" },
		sender,
	);
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-delete-failed") {
			throw new Error("模拟快照删除失败");
		}
		await originalRemove(keys);
	};

	assert.deepEqual(
		await sendAppMessage(
			firstWorker,
			{ type: "CANCEL_RUN", runId: "run-delete-failed" },
			sender,
		),
		{ ok: true },
	);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-delete-failed",
		state: "cancelled",
	});
	assert.ok(harness.session.data["run-snapshot:7:run-delete-failed"]);

	const restartedWorker = createRunStore({ chrome: harness.chrome, core: backgroundCore });
	assert.equal(await restartedWorker.getCurrentRunId(7), "");
	assert.equal(
		await restartedWorker.getCurrentRunId(7, { includeCancelled: true }),
		"run-delete-failed",
	);
	await assert.rejects(
		restartedWorker.getSnapshot(7, "run-delete-failed"),
		/翻译已取消/u,
	);
});

// 验证标签页清理失败时先写入的 cancelled 指针会保留，重启不能借残留快照继续翻译。
test("标签页快照清理失败会保留取消终态", async () => {
	const harness = createChromeHarness();
	const firstWorker = createRunStore({ chrome: harness.chrome, core: backgroundCore });
	await commitRun(firstWorker, 7, "run-closed-cleanup-failed");
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (Array.isArray(keys) && keys.includes("run-snapshot:7:run-closed-cleanup-failed")) {
			throw new Error("模拟标签页快照清理失败");
		}
		await originalRemove(keys);
	};

	await firstWorker.removeTab(7);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-closed-cleanup-failed",
		state: "cancelled",
	});
	const restartedWorker = createRunStore({ chrome: harness.chrome, core: backgroundCore });
	assert.equal(await restartedWorker.getCurrentRunId(7), "");
	assert.equal(
		await restartedWorker.getCurrentRunId(7, { includeCancelled: true }),
		"run-closed-cleanup-failed",
	);
});

// 验证升级前保存的字符串 current-run 仍按 active 状态读取，避免扩展更新打断正在运行的页面。
test("旧字符串 current-run 可兼容恢复", async () => {
	const harness = createChromeHarness();
	harness.session.data["current-run:7"] = "run-legacy";
	harness.session.data["run-snapshot:7:run-legacy"] = createSnapshot();
	const runStore = createRunStore({ chrome: harness.chrome, core: backgroundCore });

	assert.equal(await runStore.getCurrentRunId(7), "run-legacy");
	assert.equal((await runStore.getSnapshot(7, "run-legacy")).cacheGeneration, 0);
});

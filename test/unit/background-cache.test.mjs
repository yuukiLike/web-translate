import assert from "node:assert/strict";
import test from "node:test";

import { createCacheStore } from "../../chrome-extension/background/cache-store.js";
import { createRunStore } from "../../chrome-extension/background/run-store.js";
import {
	backgroundCore,
	createChromeHarness,
	createConfiguredSettings,
} from "../helpers/background-harness.mjs";

function createEntries() {
	return [
		{ id: "hello", text: "hello", translation: "你好" },
		{ id: "world", text: "world", translation: "世界" },
	];
}

function createDeferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function saveSnapshot(runStore, tabId, runId, snapshot) {
	const token = runStore.beginStart(tabId, runId);
	return runStore.saveSnapshot(tabId, runId, snapshot, token).finally(() => {
		runStore.finishStart(token);
	});
}

// 验证同一站点的完整命中与部分命中都按段落 ID 返回，不改变原请求顺序语义。
test("持久缓存支持完整命中与混合命中", async () => {
	const harness = createChromeHarness();
	const cache = createCacheStore({ chrome: harness.chrome, core: backgroundCore });
	const settings = createConfiguredSettings();
	await cache.initialize();
	await cache.store(settings, "en", "zh", createEntries(), "https://page.example", 0);

	const full = await cache.lookup(
		settings,
		"en",
		"zh",
		createEntries(),
		"https://page.example",
	);
	assert.deepEqual([...full.entries()], [
		["hello", "你好"],
		["world", "世界"],
	]);

	const mixed = await cache.lookup(
		settings,
		"en",
		"zh",
		[
			{ id: "world", text: "world" },
			{ id: "missing", text: "new text" },
		],
		"https://page.example",
	);
	assert.deepEqual([...mixed.entries()], [["world", "世界"]]);
});

// 验证相同原文不会跨站点复用，防止一个站点的内容泄漏到另一个站点。
test("持久缓存按站点来源隔离", async () => {
	const harness = createChromeHarness();
	const cache = createCacheStore({ chrome: harness.chrome, core: backgroundCore });
	const settings = createConfiguredSettings();
	await cache.initialize();
	await cache.store(
		settings,
		"en",
		"zh",
		[createEntries()[0]],
		"https://first.example",
		0,
	);

	const otherSite = await cache.lookup(
		settings,
		"en",
		"zh",
		[{ id: "hello", text: "hello" }],
		"https://second.example",
	);
	assert.equal(otherSite.size, 0);
});

// 验证清空缓存会推进 generation，使旧任务即使晚到也无法重新写入已清理的数据。
test("清空缓存会阻止旧 generation 回写", async () => {
	const harness = createChromeHarness();
	const cache = createCacheStore({ chrome: harness.chrome, core: backgroundCore });
	const settings = createConfiguredSettings();
	await cache.initialize();
	await cache.store(
		settings,
		"en",
		"zh",
		[createEntries()[0]],
		"https://page.example",
		0,
	);

	assert.ok((await cache.clear()) > 0);
	assert.equal(cache.getGeneration(), 1);
	await cache.store(
		settings,
		"en",
		"zh",
		[createEntries()[1]],
		"https://page.example",
		0,
	);
	const result = await cache.lookup(
		settings,
		"en",
		"zh",
		createEntries(),
		"https://page.example",
	);
	assert.equal(result.size, 0);
	assert.equal(harness.session.data["cache-generation"], 1);
});

// 验证任务快照和当前任务 ID 可跨 Service Worker 重启恢复，取消后会同时清理并中止请求。
test("任务快照可恢复且取消会清理持久状态", async () => {
	const harness = createChromeHarness();
	const settings = createConfiguredSettings();
	const firstWorker = createRunStore({ chrome: harness.chrome, core: backgroundCore });
	await saveSnapshot(firstWorker, 7, "run-persisted", {
		settings,
		cacheGeneration: 0,
		cacheScope: "https://page.example",
	});
	const controller = firstWorker.registerController(7, "run-persisted");

	const restartedWorker = createRunStore({ chrome: harness.chrome, core: backgroundCore });
	assert.equal(await restartedWorker.getCurrentRunId(7), "run-persisted");
	assert.equal(
		(await restartedWorker.getSnapshot(7, "run-persisted")).cacheScope,
		"https://page.example",
	);

	await firstWorker.cancel(7, "run-persisted");
	assert.equal(controller.signal.aborted, true);
	assert.equal(harness.session.data["run-snapshot:7:run-persisted"], undefined);
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-persisted",
		state: "cancelled",
	});
});

// 验证持久化新任务的途中收到取消时，会删除半写入快照并恢复此前的当前任务。
test("任务持久化途中取消会回滚当前任务指针", async () => {
	const harness = createChromeHarness();
	const settings = createConfiguredSettings();
	const runStore = createRunStore({ chrome: harness.chrome, core: backgroundCore });
	const snapshot = {
		settings,
		cacheGeneration: 0,
		cacheScope: "https://page.example",
	};
	await saveSnapshot(runStore, 7, "run-previous", snapshot);

	const writeEntered = createDeferred();
	const releaseWrite = createDeferred();
	const originalSet = harness.session.set.bind(harness.session);
	harness.session.set = async (values) => {
		await originalSet(values);
		if (values["current-run:7"]?.runId === "run-cancelled") {
			writeEntered.resolve();
			await releaseWrite.promise;
		}
	};

	const saving = saveSnapshot(runStore, 7, "run-cancelled", snapshot);
	await writeEntered.promise;
	const cancelling = runStore.cancel(7, "run-cancelled");
	releaseWrite.resolve();

	await assert.rejects(saving, /翻译已取消/u);
	await cancelling;
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-previous",
		state: "active",
	});
	assert.ok(harness.session.data["run-snapshot:7:run-previous"]);
	assert.equal(harness.session.data["run-snapshot:7:run-cancelled"], undefined);
});

// 验证标签页关闭会中止活动请求并清理该标签页的全部持久任务状态。
test("标签页关闭会释放任务资源", async () => {
	const harness = createChromeHarness();
	const settings = createConfiguredSettings();
	const runStore = createRunStore({ chrome: harness.chrome, core: backgroundCore });
	await saveSnapshot(runStore, 7, "run-closing-tab", {
		settings,
		cacheGeneration: 0,
		cacheScope: "https://page.example",
	});
	const controller = runStore.registerController(7, "run-closing-tab");

	await runStore.removeTab(7);

	assert.equal(controller.signal.aborted, true);
	assert.equal(harness.session.data["current-run:7"], undefined);
	assert.equal(harness.session.data["run-snapshot:7:run-closing-tab"], undefined);
});

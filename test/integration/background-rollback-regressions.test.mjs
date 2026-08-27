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

// 验证回滚的终态写入和旧指针恢复都失败时，删除 current 兜底仍禁止重启上传正文。
test("启动回滚双重写入失败不会留下幽灵任务", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const firstApp = createApp(harness).app;
	await firstApp.start();
	await sendAppMessage(firstApp, { type: "START_RUN", runId: "run-a" }, sender);

	const commitEntered = Promise.withResolvers();
	const releaseCommit = Promise.withResolvers();
	const originalSet = harness.session.set.bind(harness.session);
	let rejectPreviousRestore = false;
	harness.session.set = async (values) => {
		const current = values["current-run:7"];
		if (rejectPreviousRestore) {
			if (current?.runId === "run-b" && current.state === "cancelled") {
				throw new Error("模拟取消终态写入失败");
			}
			if (current?.runId === "run-a") {
				throw new Error("模拟旧指针恢复失败");
			}
		}
		await originalSet(values);
		if (current?.runId === "run-b" && current.state === "active") {
			commitEntered.resolve();
			await releaseCommit.promise;
		}
	};

	const startB = sendAppMessage(firstApp, { type: "START_RUN", runId: "run-b" }, sender);
	await commitEntered.promise;
	const originalGet = harness.local.get.bind(harness.local);
	let rejectNextSettingsRead = true;
	harness.local.get = async (keys) => {
		if (keys === backgroundCore.SETTINGS_KEY && rejectNextSettingsRead) {
			rejectNextSettingsRead = false;
			throw new Error("模拟新启动设置失败");
		}
		return await originalGet(keys);
	};
	assert.deepEqual(
		await sendAppMessage(firstApp, { type: "START_RUN", runId: "run-c" }, sender),
		{ ok: false, error: "模拟新启动设置失败" },
	);

	const cleanupEntered = Promise.withResolvers();
	const releaseCleanup = Promise.withResolvers();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-b") {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		await originalRemove(keys);
	};
	rejectPreviousRestore = true;
	releaseCommit.resolve();
	assert.deepEqual(await startB, { ok: false, error: "模拟旧指针恢复失败" });
	await cleanupEntered.promise;
	assert.equal(harness.session.data["current-run:7"], undefined);
	assert.ok(harness.session.data["run-snapshot:7:run-b"]);

	const restarted = createApp(harness);
	await restarted.app.start();
	assert.equal((await sendAppMessage(restarted.app, createBatch("run-b"), sender)).ok, false);
	assert.equal(restarted.providerRuntime.requests.length, 0);
	releaseCleanup.resolve();
});

// 验证回滚期间从 storage 回填的半提交任务会被旧指针覆盖，同一 Worker 不能继续使用它。
test("启动回滚会同步修正内存中的 current-run", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const bootstrapApp = createApp(harness).app;
	await bootstrapApp.start();
	await sendAppMessage(bootstrapApp, { type: "START_RUN", runId: "run-a" }, sender);

	const working = createApp(harness);
	await working.app.start();
	const commitEntered = Promise.withResolvers();
	const releaseCommit = Promise.withResolvers();
	const originalSet = harness.session.set.bind(harness.session);
	harness.session.set = async (values) => {
		await originalSet(values);
		const current = values["current-run:7"];
		if (current?.runId === "run-b" && current.state === "active") {
			commitEntered.resolve();
			await releaseCommit.promise;
		}
	};

	const startB = sendAppMessage(working.app, { type: "START_RUN", runId: "run-b" }, sender);
	await commitEntered.promise;
	const originalGet = harness.local.get.bind(harness.local);
	let rejectNextSettingsRead = true;
	harness.local.get = async (keys) => {
		if (keys === backgroundCore.SETTINGS_KEY && rejectNextSettingsRead) {
			rejectNextSettingsRead = false;
			throw new Error("模拟新启动设置失败");
		}
		return await originalGet(keys);
	};
	assert.deepEqual(
		await sendAppMessage(working.app, { type: "START_RUN", runId: "run-c" }, sender),
		{ ok: false, error: "模拟新启动设置失败" },
	);
	assert.deepEqual(
		await sendAppMessage(
			working.app,
			{ type: "STATUS", runId: "run-a", state: "working", completed: 1, total: 2 },
			sender,
		),
		{ ok: true, ignored: true },
	);

	const cleanupEntered = Promise.withResolvers();
	const releaseCleanup = Promise.withResolvers();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-b") {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		await originalRemove(keys);
	};
	releaseCommit.resolve();
	assert.deepEqual(await startB, {
		ok: false,
		error: "翻译启动已被较新的任务取代",
	});
	await cleanupEntered.promise;
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-a",
		state: "active",
	});
	assert.equal((await sendAppMessage(working.app, createBatch("run-b"), sender)).ok, false);
	assert.equal(working.providerRuntime.requests.length, 0);
	releaseCleanup.resolve();
});

// 验证回滚遇到慢 current 删除时必须等待删除结束再恢复旧指针，期间也不能提交其他任务。
test("启动回滚会等待慢 current 删除后恢复旧任务", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const running = createApp(harness);
	await running.app.start();
	await sendAppMessage(running.app, { type: "START_RUN", runId: "run-a" }, sender);

	const commitEntered = Promise.withResolvers();
	const releaseCommit = Promise.withResolvers();
	const originalSet = harness.session.set.bind(harness.session);
	harness.session.set = async (values) => {
		const current = values["current-run:7"];
		if (current?.runId === "run-b" && current.state === "cancelled") {
			throw new Error("模拟取消终态写入失败");
		}
		await originalSet(values);
		if (current?.runId === "run-b" && current.state === "active") {
			commitEntered.resolve();
			await releaseCommit.promise;
		}
	};

	const startB = sendAppMessage(running.app, { type: "START_RUN", runId: "run-b" }, sender);
	await commitEntered.promise;
	const originalGet = harness.local.get.bind(harness.local);
	let rejectNextSettingsRead = true;
	harness.local.get = async (keys) => {
		if (keys === backgroundCore.SETTINGS_KEY && rejectNextSettingsRead) {
			rejectNextSettingsRead = false;
			throw new Error("模拟新启动设置失败");
		}
		return await originalGet(keys);
	};
	assert.deepEqual(
		await sendAppMessage(running.app, { type: "START_RUN", runId: "run-c" }, sender),
		{ ok: false, error: "模拟新启动设置失败" },
	);

	const currentDeleteEntered = Promise.withResolvers();
	const currentDeleteFinished = Promise.withResolvers();
	const releaseCurrentDelete = Promise.withResolvers();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "current-run:7") {
			currentDeleteEntered.resolve();
			await releaseCurrentDelete.promise;
		}
		await originalRemove(keys);
		if (keys === "current-run:7") currentDeleteFinished.resolve();
	};
	releaseCommit.resolve();
	await currentDeleteEntered.promise;
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(
		await sendAppMessage(running.app, { type: "START_RUN", runId: "run-d" }, sender),
		{ ok: false, error: "标签页任务仍在清理，请重试" },
	);

	releaseCurrentDelete.resolve();
	await currentDeleteFinished.promise;
	assert.deepEqual(await startB, {
		ok: false,
		error: "翻译启动已被较新的任务取代",
	});
	assert.deepEqual(harness.session.data["current-run:7"], {
		runId: "run-a",
		state: "active",
	});
	const restarted = createApp(harness);
	await restarted.app.start();
	assert.equal((await sendAppMessage(restarted.app, createBatch("run-a"), sender)).ok, true);
	assert.equal(restarted.providerRuntime.requests.length, 1);
});

// 验证旧快照删除尚未结束时拒绝复用相同 runId，避免旧删除误删新任务快照。
test("快照清理期间不能复用相同 runId", async () => {
	const harness = createChromeHarness();
	const sender = createWebpageSender();
	const running = createApp(harness);
	await running.app.start();
	await sendAppMessage(running.app, { type: "START_RUN", runId: "run-a" }, sender);

	const cleanupEntered = Promise.withResolvers();
	const cleanupFinished = Promise.withResolvers();
	const releaseCleanup = Promise.withResolvers();
	const originalRemove = harness.session.remove.bind(harness.session);
	harness.session.remove = async (keys) => {
		if (keys === "run-snapshot:7:run-a") {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		await originalRemove(keys);
		if (keys === "run-snapshot:7:run-a") cleanupFinished.resolve();
	};
	await sendAppMessage(running.app, { type: "START_RUN", runId: "run-b" }, sender);
	await cleanupEntered.promise;

	assert.deepEqual(
		await sendAppMessage(running.app, { type: "START_RUN", runId: "run-a" }, sender),
		{ ok: false, error: "相同翻译任务仍在清理，请重试" },
	);
	releaseCleanup.resolve();
	await cleanupFinished.promise;
	await new Promise((resolve) => setTimeout(resolve, 0));
	const restarted = await sendAppMessage(
		running.app,
		{ type: "START_RUN", runId: "run-a" },
		sender,
	);
	assert.equal(restarted.ok, true, restarted.error);
	assert.equal((await sendAppMessage(running.app, createBatch("run-a"), sender)).ok, true);
	assert.equal(running.providerRuntime.requests.length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createActionUi } from "../../chrome-extension/background/action-ui.js";
import { createStatusController } from "../../chrome-extension/background/status-controller.js";
import { createChromeHarness, flushMicrotasks } from "../helpers/background-harness.mjs";

// 验证较早的慢 Badge 写入结束后会重放最新状态，最终不会覆盖后到的错误状态。
test("慢 Badge 写入结束后会恢复最新状态", async () => {
	const harness = createChromeHarness();
	const releaseWorking = Promise.withResolvers();
	const appliedTexts = [];
	harness.chrome.action.setBadgeText = async ({ text }) => {
		if (text === "25") await releaseWorking.promise;
		appliedTexts.push(text);
	};
	const actionUi = createActionUi({
		chrome: harness.chrome,
		extensionVersion: "0.4.0",
		settingsStore: {},
	});
	const controller = createStatusController({
		async getCurrentRunId() {
			return "run-current";
		},
		updateTabStatus: actionUi.updateTabStatus,
	});
	controller.startRun(7, "run-current");

	assert.deepEqual(
		await controller.handleStatus(7, "run-current", {
			state: "working",
			completed: 1,
			total: 4,
		}),
		{},
	);
	await flushMicrotasks();
	assert.deepEqual(await controller.handleStatus(7, "run-current", { state: "error" }), {});
	await flushMicrotasks();
	assert.deepEqual(appliedTexts, ["ERR"]);

	releaseWorking.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(appliedTexts, ["ERR", "25", "ERR"]);
});

// 验证冷启动并发恢复 current-run 时，以消息到达顺序而非存储读取完成顺序决定最新进度。
test("冷启动反序恢复不会让进度倒退", async () => {
	const releaseFirstRead = Promise.withResolvers();
	const updates = [];
	let readCount = 0;
	const controller = createStatusController({
		async getCurrentRunId() {
			readCount += 1;
			if (readCount === 1) await releaseFirstRead.promise;
			return "run-current";
		},
		async updateTabStatus(_tabId, message) {
			updates.push(message.completed);
		},
	});

	const early = controller.handleStatus(7, "run-current", {
		state: "working",
		completed: 1,
		total: 4,
	});
	await flushMicrotasks();
	assert.deepEqual(
		await controller.handleStatus(7, "run-current", {
			state: "working",
			completed: 3,
			total: 4,
		}),
		{},
	);
	releaseFirstRead.resolve();
	assert.deepEqual(await early, { ignored: true });
	assert.deepEqual(updates, [3]);
});

// 验证冷启动下较早的 done 即使后完成恢复，也不能越过较新的 settling 显示 OK。
test("冷启动反序恢复不会让旧完成状态越过 settling", async () => {
	const releaseFirstRead = Promise.withResolvers();
	const updates = [];
	let readCount = 0;
	const controller = createStatusController({
		async getCurrentRunId() {
			readCount += 1;
			if (readCount === 1) await releaseFirstRead.promise;
			return "run-current";
		},
		async updateTabStatus(_tabId, message) {
			updates.push(message.state);
		},
	});

	const done = controller.handleStatus(7, "run-current", { state: "done" });
	await flushMicrotasks();
	assert.deepEqual(
		await controller.handleStatus(7, "run-current", { state: "settling" }),
		{},
	);
	releaseFirstRead.resolve();
	assert.deepEqual(await done, { ignored: true });
	assert.deepEqual(updates, []);
});

// 验证旧任务取消不会覆盖当前任务的取消墓碑，持久化等待期间的状态必须继续被拒绝。
test("旧任务取消不会覆盖当前任务取消墓碑", async () => {
	const updates = [];
	const controller = createStatusController({
		async getCurrentRunId() {
			return "run-current";
		},
		async updateTabStatus(_tabId, message) {
			updates.push(message.state);
		},
	});
	controller.startRun(7, "run-current");
	controller.requestCancel(7, "run-current");
	controller.requestCancel(7, "run-old");

	assert.deepEqual(
		await controller.handleStatus(7, "run-current", {
			state: "working",
			completed: 1,
			total: 2,
		}),
		{ ignored: true },
	);
	assert.deepEqual(updates, []);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createStatusController } from "../../chrome-extension/background/status-controller.js";
import { createFakeClock, flushMicrotasks } from "../helpers/background-harness.mjs";

function createStatusHarness(currentRunId = "run-current") {
	const clock = createFakeClock();
	const updates = [];
	const controller = createStatusController({
		async getCurrentRunId() {
			return currentRunId;
		},
		async updateTabStatus(tabId, message) {
			updates.push({ tabId, state: message.state });
		},
		wait: clock.wait,
	});
	return { clock, controller, updates };
}

function createDeferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

// 验证 done 处理器保持消息通道，并在完整等待 320ms 后才写入 OK 状态。
test("完成状态等待稳定窗口后才生效", async () => {
	const { clock, controller, updates } = createStatusHarness();
	let settled = false;
	const done = controller.handleStatus(7, "run-current", { state: "done" }).then((result) => {
		settled = true;
		return result;
	});
	await flushMicrotasks();

	await clock.advanceBy(319);
	assert.equal(settled, false);
	assert.deepEqual(updates, []);
	await clock.advanceBy(1);
	assert.deepEqual(await done, {});
	assert.deepEqual(updates, [{ tabId: 7, state: "done" }]);
});

// 验证稳定窗口内出现 working 时，旧 done 会失效且不会覆盖最新进度。
test("工作状态会使等待中的完成状态失效", async () => {
	const { clock, controller, updates } = createStatusHarness();
	const done = controller.handleStatus(7, "run-current", { state: "done" });
	await flushMicrotasks();

	assert.deepEqual(
		await controller.handleStatus(7, "run-current", {
			state: "working",
			completed: 1,
			total: 2,
		}),
		{},
	);
	await clock.advanceBy(320);
	assert.deepEqual(await done, { ignored: true });
	assert.deepEqual(updates, [{ tabId: 7, state: "working" }]);
});

// 验证 settling 只负责撤销等待中的 done，不会提前写入任何 Badge。
test("稳定处理中止完成状态且不写入 Badge", async () => {
	const { clock, controller, updates } = createStatusHarness();
	const done = controller.handleStatus(7, "run-current", { state: "done" });
	await flushMicrotasks();

	assert.deepEqual(
		await controller.handleStatus(7, "run-current", { state: "settling" }),
		{},
	);
	assert.deepEqual(updates, []);
	await clock.advanceBy(320);
	assert.deepEqual(await done, { ignored: true });
	assert.deepEqual(updates, []);
});

// 验证新任务开始会立刻使旧任务等待中的 done 失效。
test("新任务开始会使旧完成状态失效", async () => {
	const { clock, controller, updates } = createStatusHarness();
	controller.startRun(7, "run-old");
	const oldDone = controller.handleStatus(7, "run-old", { state: "done" });
	await flushMicrotasks();
	controller.invalidatePending(7);
	controller.startRun(7, "run-new");

	await clock.advanceBy(320);
	assert.deepEqual(await oldDone, { ignored: true });
	assert.deepEqual(updates, []);
});

// 验证取消任务会使旧 done 失效，并让关闭状态成为最后一次 Badge 写入。
test("取消任务会覆盖等待中的完成状态", async () => {
	const { clock, controller, updates } = createStatusHarness();
	controller.startRun(7, "run-current");
	const done = controller.handleStatus(7, "run-current", { state: "done" });
	await flushMicrotasks();

	assert.equal(await controller.cancelRun(7, "run-current"), true);
	await clock.advanceBy(320);
	assert.deepEqual(await done, { ignored: true });
	assert.deepEqual(updates, [{ tabId: 7, state: "off" }]);
});

// 验证关闭 Badge 写入尚未结束时，旧任务的迟到状态也永远不能抢回界面。
test("取消开始后迟到状态永远失效", async () => {
	const offWrite = createDeferred();
	const updates = [];
	const controller = createStatusController({
		async getCurrentRunId() {
			return "run-current";
		},
		async updateTabStatus(_tabId, message) {
			updates.push(`${message.state}:start`);
			if (message.state === "off") {
				await offWrite.promise;
			}
			updates.push(`${message.state}:end`);
		},
	});
	controller.startRun(7, "run-current");
	const cancelling = controller.cancelRun(7, "run-current");
	await flushMicrotasks();

	assert.deepEqual(
		await controller.handleStatus(7, "run-current", {
			state: "working",
			completed: 1,
			total: 2,
		}),
		{ ignored: true },
	);
	offWrite.resolve();
	assert.equal(await cancelling, true);
	assert.deepEqual(updates, ["off:start", "off:end"]);
});

// 验证 Service Worker 重启后以持久化 current run 为准，旧快照不能抢回 Badge。
test("重启后只有持久化的当前任务可以更新状态", async () => {
	const updates = [];
	const restartedController = createStatusController({
		async getCurrentRunId() {
			return "run-new";
		},
		async updateTabStatus(_tabId, message) {
			updates.push(message.state);
		},
	});

	assert.deepEqual(
		await restartedController.handleStatus(7, "run-old", { state: "working" }),
		{ ignored: true },
	);
	assert.deepEqual(
		await restartedController.handleStatus(7, "run-new", { state: "working" }),
		{},
	);
	assert.deepEqual(updates, ["working"]);
});

// 验证旧任务的迟到取消只屏蔽旧 runId，不会中止新任务正在等待的完成状态。
test("旧任务取消不会使新任务完成状态失效", async () => {
	const { clock, controller, updates } = createStatusHarness("run-new");
	controller.startRun(7, "run-new");
	const done = controller.handleStatus(7, "run-new", { state: "done" });
	await flushMicrotasks();

	controller.requestCancel(7, "run-old");
	assert.equal(await controller.cancelRun(7, "run-old"), false);
	await clock.advanceBy(320);

	assert.deepEqual(await done, {});
	assert.deepEqual(updates, [{ tabId: 7, state: "done" }]);
});

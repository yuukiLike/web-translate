import assert from "node:assert/strict";
import test from "node:test";

import { ProgressTracker } from "../../src/content/progress-tracker.js";
import { StatusReporter } from "../../src/content/status-reporter.js";
import { RunTranslationCache } from "../../src/content/translation/run-cache.js";

function segment(text, sourceLanguage = "en", targetLanguage = "zh") {
	return { text, sourceLanguage, targetLanguage };
}

function createDeferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function waitFor(predicate) {
	while (!predicate()) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

// 验证运行期缓存按语言方向隔离，避免把相同原文的不同翻译方向混用。
test("运行期缓存按翻译方向隔离", () => {
	const cache = new RunTranslationCache();
	cache.set(segment("hello"), "你好");

	assert.equal(cache.get(segment("hello")), "你好");
	assert.equal(cache.has(segment("hello", "zh", "en")), false);
});

// 验证缓存最多保留 750 个段落，并优先淘汰最早写入的内容。
test("运行期缓存遵守 750 条上限", () => {
	const cache = new RunTranslationCache();
	for (let index = 0; index < 751; index += 1) {
		cache.set(segment(`text-${index}`), `translation-${index}`);
	}

	assert.equal(cache.has(segment("text-0")), false);
	assert.equal(cache.get(segment("text-1")), "translation-1");
	assert.equal(cache.get(segment("text-750")), "translation-750");
});

// 验证已完成记录在元素失效后仍保持单调，虚拟列表回收不会让完成数倒退。
test("完成计数只增不减", () => {
	const tracker = new ProgressTracker();
	const element = {};
	tracker.count(element, "en\0zh\0hash");
	tracker.complete(element, "en\0zh\0hash");
	tracker.cancelPending(element, "en\0zh\0hash");

	assert.equal(tracker.completed, 1);
	assert.equal(tracker.total, 1);
	tracker.complete(element, "en\0zh\0hash");
	assert.equal(tracker.completed, 1);
});

// 验证未完成元素被移除时会撤销待处理总数，但不会低于已经完成的数量。
test("移除待处理元素会收敛进度总数", () => {
	const tracker = new ProgressTracker();
	const completedElement = {};
	const pendingElement = {};
	tracker.count(completedElement, "first");
	tracker.complete(completedElement, "first");
	tracker.count(pendingElement, "second");

	tracker.cancelPending(pendingElement, "second");
	assert.deepEqual({ completed: tracker.completed, total: tracker.total }, { completed: 1, total: 1 });
});

// 验证相同元素和进度键只会计入一次，重复扫描不会制造虚假进度。
test("重复扫描不会重复累计进度", () => {
	const tracker = new ProgressTracker();
	const element = {};
	tracker.count(element, "same");
	tracker.count(element, "same");
	tracker.complete(element, "same");
	tracker.complete(element, "same");

	assert.deepEqual({ completed: tracker.completed, total: tracker.total }, { completed: 1, total: 1 });
});

// 验证 done 请求尚未返回时会立即发送 settling，而请求结束后失效操作保持静默。
test("完成状态请求可以被 settling 及时失效", async () => {
	const doneResponse = createDeferred();
	const states = [];
	const progress = new ProgressTracker();
	const element = {};
	progress.count(element, "completed");
	progress.complete(element, "completed");
	const reporter = new StatusReporter({
		runId: "run-current",
		progress,
		view: { hideAfterCompletion() {}, show() {} },
		runtime: {
			async reportStatus(_runId, state) {
				states.push(state);
				if (state === "done") {
					await doneResponse.promise;
				}
			},
		},
		isCurrent: () => true,
		hasPendingWork: () => false,
	});

	const completion = reporter.reportCompletion();
	await waitFor(() => states.includes("done"));
	assert.equal(reporter.invalidatePendingCompletion(), true);
	assert.deepEqual(states, ["done", "settling"]);

	doneResponse.resolve();
	await completion;
	assert.equal(reporter.invalidatePendingCompletion(), false);
	assert.deepEqual(states, ["done", "settling"]);
});

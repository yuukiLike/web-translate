import assert from "node:assert/strict";
import test from "node:test";

import { GeneratedMutationReconciler } from "../../src/content/dom/generated-mutation-reconciler.js";
import { ReplacementLineage } from "../../src/content/dom/replacement-lineage.js";
import { ProgressTracker } from "../../src/content/progress-tracker.js";
import { RootQueue } from "../../src/content/root-queue.js";
import { SITE_PRESENTATION } from "../../src/content/site-profile.js";

// 验证同一父容器一轮替换多条内容时，每一对节点都建立独立链身份。
test("同父容器的多条直接替换使用不同身份", () => {
	const lineage = new ReplacementLineage();
	const boundary = createBoundary();
	const oldFirst = {};
	const oldSecond = {};
	const newFirst = {};
	const newSecond = {};

	const observations = lineage.observe(createMutation(boundary), {
		removedNodes: [oldFirst, oldSecond],
		addedNodes: [newFirst, newSecond],
	});

	assert.equal(observations.length, 2);
	assert.notEqual(observations[0].identity, observations[1].identity);
	assert.equal(lineage.identityFor(oldFirst), lineage.identityFor(newFirst));
	assert.equal(lineage.identityFor(oldSecond), lineage.identityFor(newSecond));
});

// 验证 fresh 节点继续被替换时，会沿用首次替换建立的身份。
test("连续 fresh replacement 传播同一身份", () => {
	const lineage = new ReplacementLineage();
	const boundary = createBoundary();
	const original = {};
	const freshFirst = {};
	const freshSecond = {};

	const [first] = lineage.observe(createMutation(boundary), {
		removedNodes: [original],
		addedNodes: [freshFirst],
	});
	const [second] = lineage.observe(createMutation(boundary), {
		removedNodes: [freshFirst],
		addedNodes: [freshSecond],
	});

	assert.equal(second.identity, first.identity);
	assert.equal(lineage.identityFor(original), lineage.identityFor(freshSecond));
});

// 验证宿主先报告新增、后报告删除时，仍能把两半归为同一条 replacement 链。
test("add-before-remove 的跨回调替换仍能配对", () => {
	const lineage = new ReplacementLineage();
	const boundary = createBoundary();
	const removed = {};
	const added = {};
	const removedIdentity = lineage.identityFor(removed);

	assert.deepEqual(
		lineage.observe(createMutation(boundary), {
			removedNodes: [],
			addedNodes: [added],
		}),
		[],
	);
	const [replacement] = lineage.observe(createMutation(boundary), {
		removedNodes: [removed],
		addedNodes: [],
	});

	assert.equal(replacement.identity, removedIdentity);
	assert.equal(lineage.identityFor(added), removedIdentity);
});

// 验证普通新增留下的短期半边不会让该节点在后续替换时与自己错误配对。
test("早先独立新增不会吞掉后续真实替换", () => {
	const lineage = new ReplacementLineage();
	const boundary = createBoundary();
	const original = {};
	const fresh = {};
	const originalIdentity = lineage.identityFor(original);
	lineage.observe(createMutation(boundary), {
		removedNodes: [],
		addedNodes: [original],
	});
	lineage.observe(createMutation(boundary), {
		removedNodes: [],
		addedNodes: [fresh],
	});

	const [replacement] = lineage.observe(createMutation(boundary), {
		removedNodes: [original],
		addedNodes: [],
	});

	assert.deepEqual(replacement.addedNodes, [fresh]);
	assert.equal(replacement.identity, originalIdentity);
});

// 验证同父容器跨回调积累多个删除时，会按 DOM 槽位分别配对而非互相覆盖。
test("多个 pending removal 按槽位形成独立身份", () => {
	const lineage = new ReplacementLineage();
	const anchor = {};
	const boundary = createBoundary([anchor]);
	const oldFirst = {};
	const oldSecond = {};
	const newFirst = {};
	const newSecond = {};
	const firstIdentity = lineage.identityFor(oldFirst);
	const secondIdentity = lineage.identityFor(oldSecond);

	lineage.observe(createMutation(boundary, { nextSibling: anchor }), {
		removedNodes: [oldFirst],
		addedNodes: [],
	});
	lineage.observe(createMutation(boundary, { previousSibling: anchor }), {
		removedNodes: [oldSecond],
		addedNodes: [],
	});

	boundary.childNodes = [anchor, newSecond];
	const [secondPair] = lineage.observe(createMutation(boundary, { previousSibling: anchor }), {
		removedNodes: [],
		addedNodes: [newSecond],
	});
	boundary.childNodes = [newFirst, anchor, newSecond];
	const [firstPair] = lineage.observe(createMutation(boundary, { nextSibling: anchor }), {
		removedNodes: [],
		addedNodes: [newFirst],
	});

	assert.equal(secondPair.identity, secondIdentity);
	assert.equal(firstPair.identity, firstIdentity);
	assert.notEqual(firstPair.identity, secondPair.identity);
});

// 验证默认 500ms 配对窗口到期后会主动释放删除半边，不再与后续新增配对。
test("pending removal 超过配对窗口后主动释放", async () => {
	const lineage = new ReplacementLineage();
	const boundary = createBoundary();
	const removed = {};
	const added = {};
	const removedIdentity = lineage.identityFor(removed);

	lineage.observe(createMutation(boundary), {
		removedNodes: [removed],
		addedNodes: [],
	});
	await delay(550);
	boundary.childNodes = [added];
	const observations = lineage.observe(createMutation(boundary), {
		removedNodes: [],
		addedNodes: [added],
	});

	assert.deepEqual(observations, []);
	assert.notEqual(lineage.identityFor(added), removedIdentity);
});

// 验证 clear 会立即清空待配对删除，之后新增节点不会继承旧身份。
test("clear 后不会继续配对旧删除", () => {
	const lineage = new ReplacementLineage();
	const boundary = createBoundary();
	const removed = {};
	const added = {};
	const removedIdentity = lineage.identityFor(removed);

	lineage.observe(createMutation(boundary), {
		removedNodes: [removed],
		addedNodes: [],
	});
	lineage.clear();
	boundary.childNodes = [added];
	const observations = lineage.observe(createMutation(boundary), {
		removedNodes: [],
		addedNodes: [added],
	});

	assert.deepEqual(observations, []);
	assert.notEqual(lineage.identityFor(added), removedIdentity);
});

// 验证进度转移会合并重复键，且丢弃目标能一并撤销源元素转入的记录。
test("ProgressTracker 转移后由目标统一持有进度", () => {
	const tracker = new ProgressTracker();
	const source = {};
	const target = {};
	tracker.count(source, "shared");
	tracker.complete(source, "shared");
	tracker.count(source, "source-only");
	tracker.complete(source, "source-only");
	tracker.count(target, "shared");
	tracker.complete(target, "shared");
	tracker.count(target, "target-only");

	tracker.transfer(source, target);

	assert.deepEqual({ completed: tracker.completed, total: tracker.total }, { completed: 2, total: 3 });
	tracker.discard(source);
	assert.deepEqual({ completed: tracker.completed, total: tracker.total }, { completed: 2, total: 3 });
	tracker.discard(target);
	assert.deepEqual({ completed: tracker.completed, total: tracker.total }, { completed: 0, total: 0 });
});

// 验证添加新根时会顺手清除队列中的断连旧根，避免等待 take 才释放引用。
test("RootQueue.add 主动清理断连旧根", () =>
	withElementNodeGlobal(() => {
		const queue = new RootQueue();
		const oldRoot = createElement();
		const freshRoot = createElement();
		queue.add(oldRoot);
		oldRoot.isConnected = false;

		queue.add(freshRoot);

		assert.equal(queue.size, 1);
		assert.deepEqual(queue.take(), [freshRoot]);
	}));

// 验证连续 fresh generated source 会清除断连前驱，并让缺少译文节点的当前状态失效。
test("GeneratedMutationReconciler 不保留断连 fresh source", () => {
	const first = createElement();
	const second = createElement();
	const current = createElement();
	const inspected = [];
	const invalidated = [];
	const queuedRoots = [];
	const reconciler = new GeneratedMutationReconciler({
		runId: "run-generated",
		elementStore: {
			getState: () => ({
				originalHash: "hash",
				presentation: SITE_PRESENTATION.generated,
			}),
		},
		scanner: {
			matchesCurrentCandidate(source) {
				inspected.push(source);
				return true;
			},
		},
		invalidator: { invalidate: (source) => invalidated.push(source) },
		rootQueue: { add: (source) => queuedRoots.push(source) },
	});

	reconciler.queue(first);
	first.isConnected = false;
	reconciler.queue(second);
	second.isConnected = false;
	reconciler.queue(current);
	reconciler.reconcile();

	assert.deepEqual(inspected, [current]);
	assert.deepEqual(invalidated, [first, second, current]);
	assert.deepEqual(queuedRoots, [first, second, current, current]);
});

function createBoundary(childNodes = []) {
	return { childNodes };
}

function createMutation(target, { nextSibling = null, previousSibling = null } = {}) {
	return { nextSibling, previousSibling, target };
}

function createElement() {
	return {
		closest: () => null,
		contains: () => false,
		isConnected: true,
		matches: () => false,
		nodeType: 1,
		parentElement: null,
	};
}

function withElementNodeGlobal(callback) {
	const previousNode = globalThis.Node;
	globalThis.Node = { ELEMENT_NODE: 1 };
	try {
		return callback();
	} finally {
		globalThis.Node = previousNode;
	}
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

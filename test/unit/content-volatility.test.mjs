import assert from "node:assert/strict";
import test from "node:test";

import { ContentVolatilityTracker } from "../../src/content/volatile-content-tracker.js";
import { VolatileMutationFilter } from "../../src/content/dom/volatile-mutation-filter.js";

function createClock(initialTime = 0) {
	let currentTime = initialTime;
	return {
		advance(milliseconds) {
			currentTime += milliseconds;
		},
		now: () => currentTime,
	};
}
// 验证尚未进入扫描器的 fresh 节点也能按内容单元排除。
test("未扫描 fresh 节点也能在替换阈值后排除且不误伤稳定兄弟", () =>
	withDomGlobals(() => {
		const stableSibling = createElement("stable article");
		const removed = createElement("carousel frame 0");
		const added = createElement("carousel frame 1");
		const activityRoot = createElement("", [stableSibling, removed, added]);
		const harness = createFilterHarness({ changeLimit: 1 });

		const result = harness.filter.filter([
			createChildListRecord(activityRoot, {
				removedNodes: [removed],
				addedNodes: [added],
			}),
		]);

		assert.equal(result.accepted.length, 1);
		assert.equal(result.volatileRoots.size, 2);
		assert.equal(harness.tracker.isActivityVolatile(activityRoot), false);
		assert.equal(harness.tracker.isVolatile(added), true);
		assert.equal(harness.tracker.isVolatile(activityRoot), false);
		assert.equal(harness.tracker.isVolatile(stableSibling), false);
		assert.deepEqual(new Set(harness.discarded), new Set([removed, added]));
	}));
// 验证 textContent 移除的孤立 Text 仍使用稳定 mutation target 累计变化。
test("失去 parentElement 的未扫描 Text 替换仍按 mutation target 累计", () =>
	withDomGlobals(() => {
		const source = createElement();
		const harness = createFilterHarness({ changeLimit: 2 });
		let current = { nodeType: 3, parentElement: source, textContent: "frame 0" };
		for (let frame = 1; frame <= 2; frame += 1) {
			const removed = current;
			removed.parentElement = null;
			const added = {
				nodeType: 3,
				parentElement: source,
				textContent: `frame ${frame}`,
			};
			const result = harness.filter.filter([
				createChildListRecord(source, { removedNodes: [removed], addedNodes: [added] }),
			]);
			assert.equal(result.accepted.length, frame === 2 ? 0 : 1);
			current = added;
		}
		assert.equal(harness.tracker.isVolatile(source), true);
	}));
// 验证跨 observer delivery 的删除与新增在短窗口内配成同一次替换。
test("跨 MutationObserver 回调的 remove-only 和 add-only 会配成一次替换", () =>
	withDomGlobals(() => {
		const clock = createClock();
		const activityRoot = createElement();
		const harness = createFilterHarness({
			changeLimit: 2,
			clock: clock.now,
			replacementPairWindowMs: 50,
		});
		const initial = createElement("frame 0");
		harness.filter.filter([
			createChildListRecord(activityRoot, { addedNodes: [initial] }),
		]);
		let current = initial;

		for (let frame = 1; frame <= 2; frame += 1) {
			const removed = current;
			const added = createElement(`frame ${frame}`);
			const removal = harness.filter.filter([
				createChildListRecord(activityRoot, { removedNodes: [removed] }),
			]);
			clock.advance(1);
			const addition = harness.filter.filter([
				createChildListRecord(activityRoot, { addedNodes: [added] }),
			]);

			assert.equal(removal.accepted.length, 1);
			assert.equal(addition.accepted.length, 1);
			assert.equal(harness.tracker.isVolatile(added), frame === 2);
			current = added;
		}

		const stable = createElement("stable lazy article");
		activityRoot.childNodes = [current, stable];
		const stableResult = harness.filter.filter([
			createChildListRecord(activityRoot, { addedNodes: [stable] }),
		]);
		assert.equal(stableResult.accepted.length, 1);
		assert.equal(harness.tracker.isVolatile(stable), false);

		const future = createElement("future frame");
		activityRoot.childNodes = [stable];
		const removal = harness.filter.filter([
			createChildListRecord(activityRoot, {
				removedNodes: [current],
				nextSibling: stable,
			}),
		]);
		activityRoot.childNodes = [future, stable];
		const addition = harness.filter.filter([
			createChildListRecord(activityRoot, {
				addedNodes: [future],
				nextSibling: stable,
			}),
		]);
		assert.equal(removal.accepted.length, 1);
		assert.equal(addition.accepted.length, 1);
		assert.equal(addition.volatileRoots.size, 0);
		assert.equal(harness.tracker.isVolatile(future), true);
	}));
// 验证相隔过久的删除和新增不会被误认为同一轮动态替换。
test("超过短配对窗口的两个半记录不会累计替换", () =>
	withDomGlobals(() => {
		const clock = createClock();
		const activityRoot = createElement();
		const harness = createFilterHarness({
			changeLimit: 1,
			clock: clock.now,
			replacementPairWindowMs: 10,
		});

		harness.filter.filter([
			createChildListRecord(activityRoot, { removedNodes: [createElement("old")] }),
		]);
		clock.advance(11);
		harness.filter.filter([
			createChildListRecord(activityRoot, { addedNodes: [createElement("new")] }),
		]);

		assert.equal(harness.tracker.isActivityVolatile(activityRoot), false);
	}));
// 验证同文重渲染回收旧进度身份，同时保留稳定内容的可翻译性。
test("相同文本 fresh rerender 回收旧身份但不会永久标为易变", () =>
	withDomGlobals(() => {
		const activityRoot = createElement();
		const harness = createFilterHarness({ changeLimit: 2 });
		const removedElements = [];

		for (let frame = 0; frame < 5; frame += 1) {
			const removed = createElement("same carousel text");
			const added = createElement("same carousel text");
			removedElements.push(removed);
			const result = harness.filter.filter([
				createChildListRecord(activityRoot, { removedNodes: [removed] }),
				createChildListRecord(activityRoot, { addedNodes: [added] }),
			]);
			assert.equal(result.accepted.length, 2);
			assert.equal(result.volatileRoots.size, 0);
		}

		assert.equal(harness.tracker.isActivityVolatile(activityRoot), false);
		assert.deepEqual(harness.discarded, removedElements);
	}));
// 验证 additions-only 的无限滚动正文不会形成易变替换历史。
test("连续独立新增仍作为稳定动态正文进入扫描", () =>
	withDomGlobals(() => {
		const activityRoot = createElement();
		const harness = createFilterHarness({ changeLimit: 2 });
		for (let index = 0; index < 5; index += 1) {
			const result = harness.filter.filter([
				createChildListRecord(activityRoot, {
					addedNodes: [createElement(`article ${index}`)],
				}),
			]);
			assert.equal(result.accepted.length, 1);
		}
		assert.equal(harness.tracker.isActivityVolatile(activityRoot), false);
	}));

function createFilterHarness({
	changeLimit,
	clock = Date.now,
	replacementPairWindowMs,
} = {}) {
	const tracker = new ContentVolatilityTracker({ changeLimit, clock });
	const discarded = [];
	const filter = new VolatileMutationFilter({
		tracker,
		clock,
		replacementPairWindowMs,
			elementStore: {
				generatedSources: new Set(),
				getState: () => null,
				getTextOwner: () => null,
				hasState: () => false,
		},
		scanner: {
			findContentUnit: (element) => element,
			getPresentation: () => "flow",
			isExcluded: (element) => tracker.isVolatile(element),
		},
		invalidator: {
			discard: (element) => discarded.push(element),
			discardTrackedSubtree() {
				assert.fail("不应按活动容器丢弃整个已跟踪子树");
			},
		},
	});
	return { discarded, filter, tracker };
}

function createElement(textContent = "", descendants = []) {
	const element = {
		nodeType: 1,
		textContent,
		matches: () => false,
		closest: () => null,
		contains(candidate) {
			return descendants.includes(candidate);
		},
	};
	const textNode = { nodeType: 3, parentElement: element, textContent };
	element.textNodes = textContent ? [textNode] : [];
	return element;
}

function createChildListRecord(
	target,
	{ addedNodes = [], nextSibling = null, previousSibling = null, removedNodes = [] },
) {
	return { type: "childList", target, addedNodes, nextSibling, previousSibling, removedNodes };
}

function withDomGlobals(callback) {
	const previous = {
		Node: globalThis.Node,
		NodeFilter: globalThis.NodeFilter,
		document: globalThis.document,
	};
	globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
	globalThis.NodeFilter = { SHOW_TEXT: 4 };
	globalThis.document = {
		createTreeWalker: (node) => createTextWalker(node.textNodes ?? []),
	};
	try {
		return callback();
	} finally {
		Object.assign(globalThis, previous);
	}
}

function createTextWalker(nodes) {
	let index = 0;
	return {
		nextNode() {
			const node = nodes[index] ?? null;
			index += 1;
			return node;
		},
	};
}

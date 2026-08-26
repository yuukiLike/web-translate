import assert from "node:assert/strict";
import test from "node:test";

import { pairContentRoots } from "../../src/content/dom/mutation-content.js";
import { groupClosedReplacementMutations } from "../../src/content/dom/replacement-batch.js";

// 验证跨 record 的删除与新增共享同一左右锚点时，会组成合法替换组。
test("相同 gap 的 split records 组成替换", () => {
	const boundary = {};
	const left = {};
	const right = {};
	const removed = createRecord(boundary, { removedNodes: [{}], left, right });
	const added = createRecord(boundary, { addedNodes: [{}], left, right });

	assert.deepEqual(groupClosedReplacementMutations([removed, added]), [[removed, added]]);
});

// 验证 feed 删除头部并追加尾部时，稳定锚点不同，不会形成 generated transfer 组。
test("feed 删头加尾不会组成替换", () => {
	const boundary = {};
	const middle = {};
	const last = {};
	const removed = createRecord(boundary, {
		removedNodes: [{}],
		left: null,
		right: middle,
	});
	const added = createRecord(boundary, {
		addedNodes: [{}],
		left: last,
		right: null,
	});

	assert.deepEqual(groupClosedReplacementMutations([removed, added]), []);
});

// 验证同一 delivery 混入直接替换时，也不会把另一组 feed 删头加尾整体聚合。
test("直接替换不会放宽同 boundary 的独立 feed 记录", () => {
	const boundary = {};
	const middle = {};
	const direct = createRecord(boundary, {
		addedNodes: [{}],
		removedNodes: [{}],
	});
	const headRemoval = createRecord(boundary, {
		removedNodes: [{}],
		right: middle,
	});
	const tailAddition = createRecord(boundary, {
		addedNodes: [{}],
		left: middle,
	});

	assert.deepEqual(
		groupClosedReplacementMutations([direct, headRemoval, tailAddition]),
		[[direct]],
	);
});

// 验证 replaceWith 被拆成 add/remove 两条记录时，只配 reciprocal 中间项，不吞掉 feed 头尾。
test("split replaceWith 不会聚合相邻的 feed 删头加尾", () => {
	const oldHead = {};
	const oldMiddle = {};
	const newMiddle = {};
	const stableTail = {};
	const freshHead = {};
	const boundary = { childNodes: [newMiddle, stableTail, freshHead] };
	const removeHead = createRecord(boundary, {
		removedNodes: [oldHead],
		right: oldMiddle,
	});
	const addMiddle = createRecord(boundary, { addedNodes: [newMiddle] });
	const removeMiddle = createRecord(boundary, {
		removedNodes: [oldMiddle],
		left: newMiddle,
		right: stableTail,
	});
	const appendHead = createRecord(boundary, { addedNodes: [freshHead] });

	assert.deepEqual(
		groupClosedReplacementMutations([
			removeHead,
			addMiddle,
			removeMiddle,
			appendHead,
		]),
		[[removeMiddle, addMiddle]],
	);
});

// 验证多个 survivor 都 fresh 重渲染时，已识别的 reciprocal 组仍不能放宽剩余 feed 位移。
test("fresh survivor 组不会让剩余 feed 记录触发 full fallback", () => {
	const oldHead = {};
	const oldMiddle = {};
	const oldTail = {};
	const newMiddle = {};
	const newTail = {};
	const freshHead = {};
	const boundary = { childNodes: [newMiddle, newTail, freshHead] };
	const records = [
		createRecord(boundary, { removedNodes: [oldHead], right: oldMiddle }),
		createRecord(boundary, { addedNodes: [newMiddle] }),
		createRecord(boundary, {
			removedNodes: [oldMiddle],
			left: newMiddle,
			right: oldTail,
		}),
		createRecord(boundary, { addedNodes: [newTail] }),
		createRecord(boundary, { removedNodes: [oldTail], left: newTail }),
		createRecord(boundary, { addedNodes: [freshHead] }),
	];

	assert.deepEqual(groupClosedReplacementMutations(records), [
		[records[2], records[1]],
		[records[4], records[3]],
	]);
});

// 验证整容器替换的最终子节点全部来自本批新增时，允许按文本键完成多项重排。
test("完整 boundary replacement 保留多项重排组", () => {
	const oldFirst = {};
	const oldSecond = {};
	const newSecond = {};
	const newFirst = {};
	const boundary = { childNodes: [newSecond, newFirst] };
	const records = [
		createRecord(boundary, { removedNodes: [oldFirst], right: oldSecond }),
		createRecord(boundary, { removedNodes: [oldSecond] }),
		createRecord(boundary, { addedNodes: [newSecond] }),
		createRecord(boundary, { addedNodes: [newFirst] }),
	];

	assert.deepEqual(groupClosedReplacementMutations(records), [records]);
});

// 验证同标签根发生重排时，优先按相同文本配对，再把真正变化的根单独配对。
test("同标签内容根重排优先保持同文身份", () => {
	const oldStable = createRoot("P");
	const oldChanging = createRoot("P");
	const newChanging = createRoot("P");
	const newStable = createRoot("P");
	const removed = createSide([
		[oldStable, "Stable text"],
		[oldChanging, "Old changing text"],
	]);
	const added = createSide([
		[newChanging, "New changing text"],
		[newStable, "Stable text"],
	]);

	const { pairs, unpairedRemoved } = pairContentRoots(removed, added);
	const mappings = pairs.map(({ removed: source, added: target }) => [
		[...source.roots][0],
		[...target.roots][0],
	]);
	assert.deepEqual(new Map(mappings).get(oldStable), newStable);
	assert.deepEqual(new Map(mappings).get(oldChanging), newChanging);
	assert.deepEqual(unpairedRemoved, []);
});

function createRecord(
	target,
	{ addedNodes = [], removedNodes = [], left = null, right = null },
) {
	return {
		type: "childList",
		target,
		addedNodes,
		removedNodes,
		previousSibling: left,
		nextSibling: right,
	};
}

function createRoot(tagName) {
	return { tagName, dataset: {}, getAttribute: () => null };
}

function createSide(entries) {
	return {
		roots: new Set(entries.map(([root]) => root)),
		textByRoot: new Map(entries),
	};
}

import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { pairReplacementNodes } from "../../src/content/dom/mutation-content.js";

// 验证整窗 fresh 滑动只传播同文 survivor，离窗 head 与入窗 tail 不共享身份。
test("多节点滑动窗口保持边缘节点独立", () => {
	const removed = createNodes("article 1", "article 2", "article 3");
	const added = createNodes("article 2", "article 3", "article 4");

	const plan = pairReplacementNodes(removed, added);

	assert.deepEqual(pairTexts(plan), [
		["article 2", "article 2"],
		["article 3", "article 3"],
	]);
	assert.deepEqual(nodeTexts(plan.unpairedRemoved), ["article 1"]);
	assert.deepEqual(nodeTexts(plan.unpairedAdded), ["article 4"]);
	assert.deepEqual(plan.remainingRemoved, []);
	assert.deepEqual(plan.remainingAdded, []);
});

// 验证稳定同文节点旁的真正同槽变化仍被视作 replacement，而非普通新增。
test("同文 survivor 旁的同槽余项继续配对", () => {
	const removed = createNodes("stable heading", "frame 1");
	const added = createNodes("stable heading", "frame 2");

	const plan = pairReplacementNodes(removed, added);

	assert.deepEqual(pairTexts(plan), [
		["stable heading", "stable heading"],
		["frame 1", "frame 2"],
	]);
	assert.deepEqual(plan.unpairedRemoved, []);
	assert.deepEqual(plan.unpairedAdded, []);
});

// 验证没有同文证据的整批 rerender 仍按原槽位传播变化历史。
test("全量变化的多节点 rerender 按槽位配对", () => {
	const removed = createNodes("first 1", "second 1");
	const added = createNodes("first 2", "second 2");

	const plan = pairReplacementNodes(removed, added);

	assert.deepEqual(pairTexts(plan), [
		["first 1", "first 2"],
		["second 1", "second 2"],
	]);
	assert.deepEqual(plan.unpairedRemoved, []);
	assert.deepEqual(plan.unpairedAdded, []);
});

// 验证唯一强语义键让换位且换文的动态项延续身份，稳定同文兄弟仍各自配对。
test("唯一 testid 配对换位且换文的动态项", () => {
	const [oldTicker] = createNodes("ticker frame 1");
	oldTicker.dataset.testid = "live-ticker";
	const stable = createNodes("stable A", "stable B");
	const [newTicker] = createNodes("ticker frame 2");
	newTicker.dataset.testid = "live-ticker";

	const plan = pairReplacementNodes([oldTicker, ...stable], [...createNodes("stable A", "stable B"), newTicker]);

	assert.equal(
		plan.pairs.some(
			({ removedNode, addedNode }) => removedNode === oldTicker && addedNode === newTicker,
		),
		true,
	);
	assert.deepEqual(plan.unpairedRemoved, []);
	assert.deepEqual(plan.unpairedAdded, []);
});

// 验证列表中重复的通用 testid 不会把滑出 head 与新 tail 误连成动态项。
test("重复 testid 不放宽滑窗边缘配对", () => {
	const removed = createNodes("article 1", "article 2", "article 3");
	const added = createNodes("article 2", "article 3", "article 4");
	for (const node of [...removed, ...added]) {
		node.dataset.testid = "feed-item";
	}

	const plan = pairReplacementNodes(removed, added);

	assert.deepEqual(nodeTexts(plan.unpairedRemoved), ["article 1"]);
	assert.deepEqual(nodeTexts(plan.unpairedAdded), ["article 4"]);
});

// 验证强语义身份优先于宽松同文，动态旧文本不会串给恰好同文的稳定新节点。
test("唯一 testid 不被稳定同文节点抢占", () => {
	const [oldTicker, oldStable] = createNodes("Online", "Stable label");
	oldTicker.dataset.testid = "live-ticker";
	const [newStable, newTicker] = createNodes("Online", "Offline");
	newTicker.dataset.testid = "live-ticker";

	const plan = pairReplacementNodes(
		[oldTicker, oldStable],
		[newStable, newTicker],
	);

	assert.equal(
		plan.pairs.some(
			({ removedNode, addedNode }) => removedNode === oldTicker && addedNode === newTicker,
		),
		true,
	);
	assert.equal(
		plan.pairs.some(({ addedNode }) => addedNode === newStable),
		false,
	);
});

// 验证 id 与 aria-live 强键同样先于同文结构匹配，不把动态身份传给稳定节点。
test("id 与 aria-live 不被稳定同文节点抢占", () => {
	for (const markDynamic of [
		(node) => {
			node.id = "live-status";
		},
		(node) => {
			node.setAttribute("aria-live", "polite");
		},
	]) {
		const [oldDynamic, oldStable] = createNodes("Online", "Stable label");
		const [newStable, newDynamic] = createNodes("Online", "Offline");
		markDynamic(oldDynamic);
		markDynamic(newDynamic);

		const plan = pairReplacementNodes(
			[oldDynamic, oldStable],
			[newStable, newDynamic],
		);

		assert.equal(
			plan.pairs.some(
				({ removedNode, addedNode }) =>
					removedNode === oldDynamic && addedNode === newDynamic,
			),
			true,
		);
		assert.equal(plan.pairs.some(({ addedNode }) => addedNode === newStable), false);
	}
});

// 验证两侧不相等的唯一强键不会降级参与同文或同槽，避免身份跨语义边界串线。
test("未匹配的唯一强键保持独立", () => {
	const [oldDynamic, oldStable] = createNodes("Online", "Stable label");
	oldDynamic.id = "old-live-status";
	const [newStable, newDynamic] = createNodes("Online", "Offline");
	newDynamic.id = "new-live-status";

	const plan = pairReplacementNodes(
		[oldDynamic, oldStable],
		[newStable, newDynamic],
	);

	assert.equal(plan.pairs.some(({ removedNode }) => removedNode === oldDynamic), false);
	assert.equal(plan.pairs.some(({ addedNode }) => addedNode === newDynamic), false);
	assert.deepEqual(plan.unpairedRemoved, [oldDynamic, oldStable]);
	assert.deepEqual(plan.unpairedAdded, [newStable, newDynamic]);
});

// 验证旧节点内的真实 generated 译文不会让无 testid 的重排退化为按槽位串线。
test("真实 generated child 不污染重排文本身份", () => {
	const window = new Window();
	const previous = installDomGlobals(window);
	try {
		const oldFirst = createDomNode(window.document, "First source", "第一条译文");
		const oldSecond = createDomNode(window.document, "Second source", "第二条译文");
		const newSecond = createDomNode(window.document, "Second source");
		const newFirst = createDomNode(window.document, "First source");

		const plan = pairReplacementNodes(
			[oldFirst, oldSecond],
			[newSecond, newFirst],
		);

		assert.equal(hasPair(plan, oldFirst, newFirst), true);
		assert.equal(hasPair(plan, oldSecond, newSecond), true);
	} finally {
		Object.assign(globalThis, previous);
		window.close();
	}
});

function createDomNode(document, sourceText, translationText = "") {
	const source = document.createElement("p");
	source.append(document.createTextNode(sourceText));
	if (translationText) {
		const translation = document.createElement("span");
		translation.className = "bt-translation bt-translation-generated";
		translation.dataset.btOwned = "true";
		translation.textContent = translationText;
		source.append(translation);
	}
	return source;
}

function installDomGlobals(window) {
	const previous = {
		document: globalThis.document,
		Node: globalThis.Node,
		NodeFilter: globalThis.NodeFilter,
	};
	Object.assign(globalThis, {
		document: window.document,
		Node: window.Node,
		NodeFilter: window.NodeFilter,
	});
	return previous;
}

function hasPair(plan, removedNode, addedNode) {
	return plan.pairs.some(
		(pair) => pair.removedNode === removedNode && pair.addedNode === addedNode,
	);
}

function createNodes(...texts) {
	return texts.map((textContent) => {
		const attributes = new Map();
		return {
			textContent,
			tagName: "P",
			dataset: {},
			id: "",
			getAttribute: (name) => attributes.get(name) ?? null,
			setAttribute: (name, value) => attributes.set(name, value),
		};
	});
}

function pairTexts({ pairs }) {
	return pairs.map(({ removedNode, addedNode }) => [
		removedNode.textContent,
		addedNode.textContent,
	]);
}

function nodeTexts(nodes) {
	return nodes.map(({ textContent }) => textContent);
}

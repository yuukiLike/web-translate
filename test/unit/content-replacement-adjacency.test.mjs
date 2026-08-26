import assert from "node:assert/strict";
import test from "node:test";

import { ReplacementLineage } from "../../src/content/dom/replacement-lineage.js";
import { VolatilityRouteContext } from "../../src/content/dom/volatility-route-context.js";
import { ContentVolatilityTracker } from "../../src/content/volatile-content-tracker.js";

// 验证 fresh 先插到旧节点旁、下一回调再删除旧节点时，仍沿用旧节点身份。
test("跨回调 add-after-remove 通过双向相邻关系配对", () => {
	const lineage = new ReplacementLineage();
	const boundary = createBoundary();
	const oldNode = {};
	const freshNode = {};
	const identity = lineage.identityFor(oldNode);

	boundary.childNodes = [oldNode, freshNode];
	lineage.observe(createMutation(boundary, { previousSibling: oldNode }), {
		removedNodes: [],
		addedNodes: [freshNode],
	});
	boundary.childNodes = [freshNode];
	const [replacement] = lineage.observe(
		createMutation(boundary, { nextSibling: freshNode }),
		{ removedNodes: [oldNode], addedNodes: [] },
	);

	assert.equal(replacement.identity, identity);
	assert.equal(lineage.identityFor(freshNode), identity);
	lineage.clear();
});

// 验证节点自己的新增记录被删除后，当前 removal 仍会等待真正 successor。
test("self-add 不会吞掉下一回调的真实 successor", () => {
	const lineage = new ReplacementLineage();
	const boundary = createBoundary();
	const initial = {};
	const successor = {};
	const identity = lineage.identityFor(initial);

	boundary.childNodes = [initial];
	lineage.observe(createMutation(boundary), {
		removedNodes: [],
		addedNodes: [initial],
	});
	boundary.childNodes = [];
	lineage.observe(createMutation(boundary), {
		removedNodes: [initial],
		addedNodes: [],
	});
	boundary.childNodes = [successor];
	const [replacement] = lineage.observe(createMutation(boundary), {
		removedNodes: [],
		addedNodes: [successor],
	});

	assert.equal(replacement.identity, identity);
	lineage.clear();
});

// 验证持续加入新半边不会延长最早半边的 500ms 生命周期。
test("每个 pending half 按自己的到期时间释放", () => {
	const clock = createClock();
	const lineage = new ReplacementLineage({ clock: clock.now, pairWindowMs: 10 });
	const anchor = {};
	const boundary = createBoundary([anchor]);
	const firstRemoved = {};
	const secondRemoved = {};
	const firstIdentity = lineage.identityFor(firstRemoved);
	const secondIdentity = lineage.identityFor(secondRemoved);

	lineage.observe(createMutation(boundary, { nextSibling: anchor }), {
		removedNodes: [firstRemoved],
		addedNodes: [],
	});
	clock.advance(5);
	lineage.observe(createMutation(boundary, { previousSibling: anchor }), {
		removedNodes: [secondRemoved],
		addedNodes: [],
	});
	clock.advance(6);
	const firstFresh = {};
	boundary.childNodes = [firstFresh, anchor];
	assert.deepEqual(
		lineage.observe(createMutation(boundary, { nextSibling: anchor }), {
			removedNodes: [],
			addedNodes: [firstFresh],
		}),
		[],
	);
	assert.notEqual(lineage.identityFor(firstFresh), firstIdentity);

	const secondFresh = {};
	boundary.childNodes = [firstFresh, secondFresh, anchor];
	const [replacement] = lineage.observe(createMutation(boundary, { previousSibling: anchor }), {
		removedNodes: [],
		addedNodes: [secondFresh],
	});
	assert.equal(replacement.identity, secondIdentity);
	lineage.clear();
});

// 验证 SPA 路由每次变化都会同时清空易变排除和旧节点身份，包括 A→B→A。
test("路由世代重置 tracker 与 lineage", () => {
	let routeKey = "/route-a";
	const tracker = new ContentVolatilityTracker({ changeLimit: 1 });
	const lineage = new ReplacementLineage();
	const context = new VolatilityRouteContext({
		tracker,
		lineage,
		getRouteKey: () => routeKey,
	});
	const source = {};
	context.sync();
	const firstIdentity = lineage.identityFor(source);
	tracker.recordChange(firstIdentity, [source]);
	assert.equal(tracker.isVolatile(source), true);

	routeKey = "/route-b";
	context.sync();
	assert.equal(tracker.isVolatile(source), false);
	const secondIdentity = lineage.identityFor(source);
	assert.notEqual(secondIdentity, firstIdentity);

	routeKey = "/route-a";
	context.sync();
	assert.notEqual(lineage.identityFor(source), secondIdentity);
});

function createBoundary(childNodes = []) {
	return { childNodes };
}

function createMutation(target, { nextSibling = null, previousSibling = null } = {}) {
	return { nextSibling, previousSibling, target };
}

function createClock() {
	let current = 0;
	return {
		advance(milliseconds) {
			current += milliseconds;
		},
		now: () => current,
	};
}

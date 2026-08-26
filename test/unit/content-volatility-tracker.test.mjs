import assert from "node:assert/strict";
import test from "node:test";

import {
	CONTENT_VOLATILITY,
	ContentVolatilityTracker,
} from "../../src/content/volatile-content-tracker.js";

// 验证默认变化阈值与时间窗是不可变的产品契约。
test("易变内容默认参数不可变", () => {
	assert.deepEqual(CONTENT_VOLATILITY, { changeLimit: 3, windowMs: 15_000 });
	assert.equal(Object.isFrozen(CONTENT_VOLATILITY), true);
});

// 验证活动达到阈值后只排除当前变化单元，不保留或误伤此前的稳定兄弟。
test("时间窗内的连续变化仅排除当前内容单元", () => {
	const clock = createClock();
	const tracker = new ContentVolatilityTracker({ clock: clock.now });
	const first = createElement();
	const firstChild = createElement(first);
	const second = createElement();
	const stableSibling = createElement();
	const activityIdentity = {};

	assert.equal(tracker.recordChange(activityIdentity, [first]).becameVolatile, false);
	clock.advance(1_000);
	assert.equal(tracker.recordChange(activityIdentity, [second]).becameVolatile, false);
	clock.advance(1_000);
	const result = tracker.recordChange(activityIdentity, [first]);

	assert.equal(result.becameVolatile, true);
	assert.deepEqual(result.affectedElements, [first]);
	assert.equal(tracker.isActivityVolatile(activityIdentity), true);
	assert.equal(tracker.isVolatile(first), true);
	assert.equal(tracker.isVolatile(firstChild), true);
	assert.equal(tracker.isVolatile(second), false);
	assert.equal(tracker.isVolatile(stableSibling), false);
});

// 验证已确认的易变活动可以把后续同链内容加入运行级排除集合。
test("已易变活动可以继续排除新出现的内容单元", () => {
	const tracker = new ContentVolatilityTracker({ changeLimit: 1 });
	const activityIdentity = {};
	const initial = createElement();
	const next = createElement();

	tracker.recordChange(activityIdentity, [initial]);
	const excluded = tracker.excludeForVolatileActivity(activityIdentity, [next]);

	assert.deepEqual(excluded, [next]);
	assert.equal(tracker.isVolatile(next), true);
	assert.deepEqual(tracker.excludeForVolatileActivity({}, [createElement()]), []);
});

function createClock() {
	let currentTime = 0;
	return {
		advance(milliseconds) {
			currentTime += milliseconds;
		},
		now: () => currentTime,
	};
}

function createElement(parentElement = null) {
	return { parentElement };
}

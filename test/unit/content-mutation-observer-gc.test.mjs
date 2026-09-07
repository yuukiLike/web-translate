import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// 验证测试环境在观察期间跨 GC 保持真实事件投递，断开后仍能释放内部回调。
test("Happy DOM observer 跨 GC 投递并在 disconnect 后释放回调", () => {
	const helperUrl = new URL("../helpers/retain-mutation-observers.mjs", import.meta.url).href;
	const result = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "--eval", `
		import assert from "node:assert/strict";
		import { Window, PropertySymbol } from "happy-dom";
		import { retainMutationObserverCallbacks } from ${JSON.stringify(helperUrl)};
		const window = new Window();
		retainMutationObserverCallbacks(window);
		const target = window.document.body;
		const deliveries = [];
		const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
		const observer = new window.MutationObserver((records) => deliveries.push(records));
		observer.observe(target, {
			childList: true, subtree: true, attributes: true,
			attributeFilter: ["title"], attributeOldValue: true,
		});
		const callbackRef = target[PropertySymbol.mutationListeners][0].callback;
		const paragraph = window.document.createElement("p");
		target.append(paragraph);
		await nextTask();
		assert.equal(deliveries.length, 1);
		assert.equal(deliveries[0][0].type, "childList");

		global.gc();
		paragraph.setAttribute("title", "first");
		paragraph.setAttribute("title", "second");
		paragraph.setAttribute("data-ignored", "not observed");
		await nextTask();
		assert.equal(deliveries.length, 2, "存活 observer 的回调被 GC 回收");
		assert.deepEqual(deliveries[1].map(({ attributeName, oldValue }) =>
			({ attributeName, oldValue })), [
			{ attributeName: "title", oldValue: null },
			{ attributeName: "title", oldValue: "first" },
		]);

		paragraph.setAttribute("title", "pending");
		assert.equal(observer.takeRecords().length, 1);
		await nextTask();
		assert.equal(deliveries.length, 2, "takeRecords 后不应再次投递");
		observer.disconnect();
		await nextTask();
		global.gc();
		assert.equal(callbackRef.deref(), undefined, "disconnect 后仍强引用内部回调");
		paragraph.setAttribute("title", "disconnected");
		await nextTask();
		assert.equal(deliveries.length, 2, "disconnect 后不应投递");
		window.close();
	`], { cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 10_000 });
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

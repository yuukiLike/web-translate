import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const VISIBLE_TEXT =
	"The visible article explains how edge networks keep applications responsive worldwide.";
const DEFERRED_TEXT =
	"The deferred article appears after its surrounding interface finishes loading.";
const COMPLETE_ONE = "双语翻译完成，已覆盖 1 个文本块";

// 验证真实显隐变化进入完成态结算，避免先报 done、随后又恢复 working。
test("延迟显示的正文阻止过早完成状态", async () => {
	const harness = createContentHarness();
	let animationTimer = null;
	try {
		const visible = harness.addArticle(VISIBLE_TEXT);
		const deferred = harness.addArticle(DEFERRED_TEXT);
		deferred.source.style.display = "none";

		harness.start();
		let animationFrame = 0;
		animationTimer = setInterval(() => {
			animationFrame += 1;
			visible.source.className = `pulse-${animationFrame % 2}`;
			visible.source.style.transform = `translateX(${animationFrame % 3}px)`;
		}, 12);
		setTimeout(() => {
			deferred.source.style.display = "block";
		}, 100);

		await waitFor(
			() => Boolean(harness.getTranslation(visible.source)),
			"初始可见正文没有生成译文",
		);
		await waitFor(
			() => Boolean(harness.getTranslation(deferred.source)),
			"延迟显示正文没有生成译文",
		);
		await waitFor(
			() => harness.statusText() === "双语翻译完成，已覆盖 2 个文本块",
			"延迟显示正文没有收敛到最终完成状态",
		);

		const statusStates = harness.messages
			.filter(({ type }) => type === "STATUS")
			.map(({ state }) => state);
		assert.deepEqual(statusStates, ["working", "working", "done"]);
		const frameAtCompletion = animationFrame;
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.ok(animationFrame > frameAtCompletion);
	} finally {
		if (animationTimer !== null) {
			clearInterval(animationTimer);
		}
		harness.dispose();
	}
});

// 验证无正文装饰节点持续改变布局签名时仍可完成，不把纯布局动画当成翻译任务。
test("装饰节点的持续布局动画不阻塞完成状态", async () => {
	const harness = createContentHarness();
	let animationTimer = null;
	try {
		const visible = harness.addArticle(VISIBLE_TEXT);
		const decoration = harness.document.createElement("div");
		harness.root.append(decoration);
		let animationFrame = 0;
		animationTimer = setInterval(() => {
			animationFrame += 1;
			decoration.style.display = animationFrame % 2 === 0 ? "block" : "flex";
		}, 12);

		harness.start();
		await waitFor(
			() =>
				Boolean(harness.getTranslation(visible.source)) &&
				harness.statusText() === COMPLETE_ONE,
			"装饰节点的布局动画阻塞了完成状态",
		);
		const frameAtCompletion = animationFrame;
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.ok(animationFrame > frameAtCompletion);
	} finally {
		if (animationTimer !== null) {
			clearInterval(animationTimer);
		}
		harness.dispose();
	}
});

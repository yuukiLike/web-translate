import assert from "node:assert/strict";
import test from "node:test";

import { TIMING } from "../../src/content/constants.js";
import { CONTENT_VOLATILITY } from "../../src/content/volatile-content-tracker.js";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const WAIT_TIMEOUT = 5_000;

// 验证每次真实 SPA 路由切换都创建新的易变判断世代，同一 outlet 不会累计成轮播。
test("SPA outlet 跨路由替换仍逐页翻译", async () => {
	const harness = createContentHarness();
	try {
		const outlet = harness.document.createElement("section");
		let source = createParagraph(harness.document, "Route start has stable readable prose.");
		outlet.append(source);
		harness.root.append(outlet);
		harness.start();
		await waitForTranslation(harness, source, "初始路由正文没有完成翻译");

		const routes = ["/route-a", "/route-b", "/route-a", "/route-c"];
		for (const [index, route] of routes.entries()) {
			harness.window.history.pushState({}, "", route);
			const fresh = createParagraph(
				harness.document,
				`SPA route ${index + 1} contains stable readable prose.`,
			);
			source.replaceWith(fresh);
			source = fresh;
			await waitForTranslation(harness, source, `路由 ${route} 的正文被错误跳过`);
		}

		for (let index = 0; index < routes.length; index += 1) {
			assert.equal(
				harness.requestCount(`SPA route ${index + 1} contains stable readable prose.`),
				1,
			);
		}
	} finally {
		harness.dispose();
	}
});

// 验证旧页面已标记易变的同一个 Element，在新路由复用后可以承载稳定正文。
test("SPA 新路由解除复用节点的旧易变排除", async () => {
	const harness = createContentHarness();
	try {
		const source = createParagraph(harness.document, "Route A begins with stable prose.");
		harness.root.append(source);
		harness.start();
		await waitForTranslation(harness, source, "Route A 初始正文没有完成翻译");

		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit; frame += 1) {
			source.textContent = `Route A animation frame ${frame} changes quickly.`;
			if (frame < CONTENT_VOLATILITY.changeLimit) {
				await waitForTranslation(harness, source, `Route A 第 ${frame} 帧没有完成翻译`);
			}
		}
		await waitFor(
			() => source.dataset.btSource === undefined,
			"Route A 动画没有进入易变状态",
			WAIT_TIMEOUT,
		);

		harness.window.history.pushState({}, "", "/route-b");
		source.textContent = "Route B reuses the node for stable readable prose.";
		await waitForTranslation(harness, source, "新路由仍继承旧页面的易变排除");
		assert.equal(harness.requestCount(source.textContent), 1);
	} finally {
		harness.dispose();
	}
});

// 验证同页 hash 变化不伪装成 SPA 换页，轮播链仍会达到易变阈值。
test("hash 变化不会重置同页易变历史", async () => {
	const harness = createContentHarness();
	try {
		let source = createParagraph(harness.document, "Hash carousel starts with stable prose.");
		harness.root.append(source);
		harness.start();
		await waitForTranslation(harness, source, "hash 场景初始正文没有完成翻译");

		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit; frame += 1) {
			harness.window.history.pushState({}, "", `#frame-${frame}`);
			const fresh = createParagraph(
				harness.document,
				`Hash carousel frame ${frame} changes on the same page.`,
			);
			source.replaceWith(fresh);
			source = fresh;
			if (frame < CONTENT_VOLATILITY.changeLimit) {
				await waitForTranslation(harness, source, `hash 第 ${frame} 帧没有完成翻译`);
			}
		}

		await delay(TIMING.mutationDebounce + TIMING.completionSettle + 100);
		assert.equal(source.dataset.btSource, undefined);
		assert.equal(harness.getTranslation(source), null);
		assert.equal(harness.requestCount(source.textContent), 0);
	} finally {
		harness.dispose();
	}
});

function createParagraph(document, text) {
	const source = document.createElement("p");
	source.textContent = text;
	return source;
}

async function waitForTranslation(harness, source, message) {
	await waitFor(
		() => harness.getTranslation(source)?.textContent === `译文：${source.textContent}`,
		message,
		WAIT_TIMEOUT,
	);
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

import assert from "node:assert/strict";
import test from "node:test";

import { TIMING } from "../../src/content/constants.js";
import { CONTENT_VOLATILITY } from "../../src/content/volatile-content-tracker.js";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const WAIT_TIMEOUT = 5_000;

// 验证 wrapper 内稳定 generated 根与变化根各自维护身份，变化标题不会连带丢弃稳定正文。
test("部分 generated replacement 不合并兄弟内容身份", async () => {
	const harness = createContentHarness();
	try {
		prepareXHarness(harness);
		const stableText = "A stable generated paragraph keeps its own identity.";
		let surface = createSurface(harness.document, stableText, "Changing heading starts here.");
		harness.root.append(surface.wrapper);
		harness.start();
		await waitForGenerated(harness, surface.stable, stableText, "初始稳定 generated 正文没有译文");
		await waitForGenerated(
			harness,
			surface.changing,
			surface.changing.textContent,
			"初始变化 generated 正文没有译文",
		);
		const stableDescriptionId = surface.stable.dataset.btDescriptionId;

		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit; frame += 1) {
			const fresh = createSurface(
				harness.document,
				stableText,
				`Changing heading frame ${frame} has new text.`,
			);
			surface.wrapper.replaceWith(fresh.wrapper);
			surface = fresh;
			await waitForGenerated(harness, surface.stable, stableText, "稳定兄弟译文迁移失败");
			if (frame < CONTENT_VOLATILITY.changeLimit) {
				await waitForGenerated(
					harness,
					surface.changing,
					surface.changing.textContent,
					`变化正文第 ${frame} 帧没有译文`,
				);
			}
		}

		await settleMutationScan();
		assert.equal(surface.stable.dataset.btDescriptionId, stableDescriptionId);
		assert.equal(surface.stable.dataset.btTranslation, `译文：${stableText}`);
		assert.equal(harness.requestCount(stableText), 1);
		assert.equal(surface.changing.dataset.btSource, undefined);
		assert.equal(surface.changing.dataset.btTranslation, undefined);
	} finally {
		harness.dispose();
	}
});

// 验证 generated feed 删头加尾即使文本相同，也不会迁移旧槽位的呈现或易变历史。
test("generated feed 同文删头加尾保持独立身份", async () => {
	const harness = createContentHarness();
	try {
		prepareXHarness(harness);
		const section = harness.document.createElement("section");
		const first = createTweet(harness.document, "Feed item starts with readable prose.");
		const middle = createTweet(harness.document, "A stable middle feed item remains visible.");
		const last = createTweet(harness.document, "A stable final feed item remains visible.");
		section.append(first.article, middle.article, last.article);
		harness.root.append(section);
		harness.start();
		await waitForGenerated(harness, first.source, first.source.textContent, "首条 feed 没有译文");

		for (let frame = 1; frame < CONTENT_VOLATILITY.changeLimit; frame += 1) {
			first.source.textContent = `Feed head revision ${frame} keeps changing.`;
			await waitForGenerated(harness, first.source, first.source.textContent, "旧首条变化没有译文");
		}
		const repeatedText = first.source.textContent;
		const oldDescriptionId = first.source.dataset.btDescriptionId;
		const fresh = createTweet(harness.document, repeatedText);
		first.article.remove();
		section.append(fresh.article);
		await waitForGenerated(harness, fresh.source, repeatedText, "新尾部同文正文没有独立呈现");
		assert.notEqual(fresh.source.dataset.btDescriptionId, oldDescriptionId);

		const nextText = "The new tail changes once and remains stable.";
		fresh.source.textContent = nextText;
		await waitForGenerated(harness, fresh.source, nextText, "新尾部错误继承旧首条易变历史");
		assert.equal(harness.requestCount(nextText), 1);
	} finally {
		harness.dispose();
	}
});

// 验证同一 delivery 混入 reciprocal replaceWith 时，只迁移中间项，不迁移 feed 头到尾。
test("generated mixed replaceWith 与 feed 操作保持分组", async () => {
	const harness = createContentHarness();
	try {
		prepareXHarness(harness);
		const section = harness.document.createElement("section");
		const head = createTweet(harness.document, "Mixed feed head starts here.");
		const middle = createTweet(harness.document, "Mixed feed middle stays the same.");
		const tail = createTweet(harness.document, "Mixed feed tail stays visible.");
		section.append(head.article, middle.article, tail.article);
		harness.root.append(section);
		harness.start();
		await waitForGenerated(harness, head.source, head.source.textContent, "mixed 首条没有译文");
		await waitForGenerated(harness, middle.source, middle.source.textContent, "mixed 中间项没有译文");
		await waitForGenerated(harness, tail.source, tail.source.textContent, "mixed 尾部没有译文");

		for (let frame = 1; frame < CONTENT_VOLATILITY.changeLimit; frame += 1) {
			head.source.textContent = `Mixed feed head revision ${frame}.`;
			await waitForGenerated(harness, head.source, head.source.textContent, "mixed 首条变化失败");
		}
		const headDescriptionId = head.source.dataset.btDescriptionId;
		const middleDescriptionId = middle.source.dataset.btDescriptionId;
		const tailDescriptionId = tail.source.dataset.btDescriptionId;
		const freshMiddle = createTweet(harness.document, middle.source.textContent);
		const freshTail = createTweet(harness.document, tail.source.textContent);
		const freshHead = createTweet(harness.document, head.source.textContent);
		head.article.remove();
		middle.article.replaceWith(freshMiddle.article);
		tail.article.replaceWith(freshTail.article);
		section.append(freshHead.article);

		await waitForGenerated(
			harness,
			freshMiddle.source,
			freshMiddle.source.textContent,
			"mixed 中间项没有迁移",
		);
		await waitForGenerated(
			harness,
			freshTail.source,
			freshTail.source.textContent,
			"mixed 尾部 survivor 没有迁移",
		);
		await waitForGenerated(
			harness,
			freshHead.source,
			freshHead.source.textContent,
			"mixed 新尾部没有独立呈现",
		);
		assert.equal(freshMiddle.source.dataset.btDescriptionId, middleDescriptionId);
		assert.equal(freshTail.source.dataset.btDescriptionId, tailDescriptionId);
		assert.notEqual(freshHead.source.dataset.btDescriptionId, headDescriptionId);

		const nextText = "Mixed feed new tail changes once and stays stable.";
		freshHead.source.textContent = nextText;
		await waitForGenerated(harness, freshHead.source, nextText, "mixed 新尾部继承了旧易变历史");
	} finally {
		harness.dispose();
	}
});

function createSurface(document, stableText, changingText) {
	const wrapper = document.createElement("section");
	const stableTweet = createTweet(document, stableText);
	const changingTweet = createTweet(document, changingText);
	wrapper.append(stableTweet.article, changingTweet.article);
	return { wrapper, stable: stableTweet.source, changing: changingTweet.source };
}

function createTweet(document, text) {
	const article = document.createElement("article");
	article.dataset.testid = "tweet";
	const source = document.createElement("div");
	source.dataset.testid = "tweetText";
	source.textContent = text;
	article.append(source);
	return { article, source };
}

function prepareXHarness(harness) {
	harness.window.location.href = "https://x.com/home";
	harness.document.documentElement.lang = "en";
}

async function waitForGenerated(harness, source, text, message) {
	await waitFor(
		() => source.dataset.btTranslation === `译文：${text}`,
		message,
		WAIT_TIMEOUT,
	);
}

function settleMutationScan() {
	return new Promise((resolve) =>
		setTimeout(resolve, TIMING.mutationDebounce + TIMING.completionSettle + 100),
	);
}

import assert from "node:assert/strict";
import test from "node:test";

import { TIMING } from "../../src/content/constants.js";
import { CONTENT_VOLATILITY } from "../../src/content/volatile-content-tracker.js";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const WAIT_TIMEOUT = 5_000;

// 验证宿主先插入 fresh 节点、下一 observer delivery 再删除旧节点时仍累计同一替换链。
test("add-before-remove 的跨回调顺序仍会进入易变状态", async () => {
	const harness = createContentHarness();
	try {
		const boundary = harness.document.createElement("section");
		let source = createParagraph(harness.document, "Initial carousel prose is readable.");
		boundary.append(source);
		harness.root.append(boundary);
		harness.start();
		await waitForTranslation(harness, source, "初始轮播正文没有完成翻译");

		const frameTexts = [];
		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit; frame += 1) {
			const text = `Add-first carousel frame ${frame} changes quickly.`;
			frameTexts.push(text);
			const fresh = createParagraph(harness.document, text);
			source.after(fresh);
			await nextMutationDelivery();
			source.remove();
			source = fresh;
			if (frame < CONTENT_VOLATILITY.changeLimit) {
				await waitForTranslation(harness, source, `第 ${frame} 帧没有完成翻译`);
			}
		}

		await delay(TIMING.mutationDebounce + TIMING.completionSettle + 100);
		assert.equal(source.dataset.btSource, undefined);
		assert.equal(harness.getTranslation(source), null);
		assert.ok(requestCount(harness, frameTexts) <= CONTENT_VOLATILITY.changeLimit - 1);

		const sameTextFresh = createParagraph(harness.document, source.textContent);
		source.replaceWith(sameTextFresh);
		await delay(TIMING.mutationDebounce + 50);
		assert.equal(sameTextFresh.dataset.btSource, undefined);
		assert.equal(harness.getTranslation(sameTextFresh), null);
	} finally {
		harness.dispose();
	}
});

// 验证 generated 同文迁移只迁移呈现，不会切断此前已累计的易变身份。
test("generated 同文迁移后下一次变化沿用旧谱系", async () => {
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		harness.document.documentElement.lang = "en";
		const article = harness.document.createElement("article");
		article.dataset.testid = "tweet";
		let source = createTweetText(harness.document, "Generated lineage starts here.");
		article.append(source);
		harness.root.append(article);
		harness.start();
		await waitForGenerated(harness, source, source.textContent, "初始 generated 正文没有译文");

		for (let frame = 1; frame < CONTENT_VOLATILITY.changeLimit; frame += 1) {
			source.textContent = `Generated lineage frame ${frame} changes.`;
			await waitForGenerated(harness, source, source.textContent, `第 ${frame} 帧没有译文`);
		}
		const descriptionId = source.dataset.btDescriptionId;
		const fresh = createTweetText(harness.document, source.textContent);
		source.replaceWith(fresh);
		source = fresh;
		await nextMutationDelivery();
		assert.equal(source.dataset.btDescriptionId, descriptionId);

		const finalText = "Generated lineage reaches the volatile threshold.";
		source.textContent = finalText;
		await delay(TIMING.mutationDebounce + TIMING.completionSettle + 100);
		assert.equal(source.dataset.btSource, undefined);
		assert.equal(source.dataset.btTranslation, undefined);
		assert.equal(harness.document.getElementById(descriptionId), null);
		assert.equal(harness.requestCount(finalText), 0);
	} finally {
		harness.dispose();
	}
});

function createParagraph(document, text) {
	const source = document.createElement("p");
	source.textContent = text;
	return source;
}

function createTweetText(document, text) {
	const source = document.createElement("div");
	source.dataset.testid = "tweetText";
	const span = document.createElement("span");
	span.textContent = text;
	source.append(span);
	return source;
}

async function waitForTranslation(harness, source, message) {
	await waitFor(
		() => harness.getTranslation(source)?.textContent === `译文：${source.textContent}`,
		message,
		WAIT_TIMEOUT,
	);
}

async function waitForGenerated(harness, source, text, message) {
	await waitFor(
		() => source.dataset.btTranslation === `译文：${text}`,
		message,
		WAIT_TIMEOUT,
	);
}

function requestCount(harness, texts) {
	return texts.reduce((total, text) => total + harness.requestCount(text), 0);
}

function nextMutationDelivery() {
	return delay(30);
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

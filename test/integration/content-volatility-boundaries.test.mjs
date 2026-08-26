import assert from "node:assert/strict";
import test from "node:test";

import { TIMING } from "../../src/content/constants.js";
import { CONTENT_VOLATILITY } from "../../src/content/volatile-content-tracker.js";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const COMPLETE_ONE = "双语翻译完成，已覆盖 1 个文本块";
const COMPLETE_TWO = "双语翻译完成，已覆盖 2 个文本块";
const EMPTY_STATUS = "当前页面没有需要翻译的外语正文";
const STABLE_HEADING = "This stable heading must keep its translated presentation.";

// 验证低于 mutation debounce 的 fresh-node 轮播不会请求后续帧，最终回到无需翻译状态。
test("快速 fresh 段落轮播在首次扫描前达到易变阈值", async () => {
	const harness = createContentHarness();
	try {
		const carousel = createElement(harness.document, "section");
		harness.root.append(carousel);
		harness.start();

		const frames = [];
		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit + 2; frame += 1) {
			const source = createElement(
				harness.document,
				"p",
				`A rapidly changing carousel renders frame ${frame}.`,
			);
			frames.push(source);
			carousel.replaceChildren(source);
			await delay(20);
		}

		await settleMutationScan();
		assertVolatileCarousel(harness, frames);
	} finally {
		harness.dispose();
	}
});

// 验证未扫描段落通过 textContent 快速更新时，也能使用稳定的 mutation target 识别易变状态。
test("快速 textContent 更新不翻译最终状态帧", async () => {
	const harness = createContentHarness();
	try {
		const source = createElement(
			harness.document,
			"p",
			"A workflow is preparing its initial state.",
		);
		harness.root.append(source);
		harness.start();

		const frames = [];
		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit + 2; frame += 1) {
			const text = `A workflow is preparing state frame ${frame}.`;
			frames.push(text);
			source.textContent = text;
			await delay(20);
		}

		await settleMutationScan();
		assertSkipped(harness, source);
		assert.equal(harness.requestCount(frames.at(-1)), 0);
		assert.equal(countRequestsForTexts(harness, frames.slice(1)), 0);
		assert.ok(countRequestedSegments(harness) <= 1);
		assert.equal(harness.statusText(), EMPTY_STATUS);
	} finally {
		harness.dispose();
	}
});

// 验证 remove 与 append 落在不同 observer callback 时仍按同一轮播身份累计变化并永久跳过。
test("跨 observer callback 的 fresh 段落替换仍有界", async () => {
	const harness = createContentHarness();
	try {
		const carousel = createElement(harness.document, "section");
		harness.root.append(carousel);
		harness.start();

		const frames = [createCarouselFrame(harness.document, 0)];
		carousel.append(frames[0]);
		await nextObserverTask();
		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit + 2; frame += 1) {
			frames.at(-1).remove();
			await nextObserverTask();
			const source = createCarouselFrame(harness.document, frame);
			frames.push(source);
			carousel.append(source);
			await nextObserverTask();
		}

		await settleMutationScan();
		assertVolatileCarousel(harness, frames);
	} finally {
		harness.dispose();
	}
});

// 验证易变段落与稳定标题共享父 section 时，只丢弃段落历史，不撤销标题译文或完成数。
test("共享父 section 的稳定标题不受易变段落影响", async () => {
	const harness = createContentHarness();
	try {
		const section = createElement(harness.document, "section");
		const stable = createElement(harness.document, "h2", STABLE_HEADING);
		section.append(stable);
		harness.root.append(section);
		harness.start();
		const stableTranslation = await waitForStableHeading(harness, stable);

		const frames = [];
		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit + 2; frame += 1) {
			const source = createCarouselFrame(harness.document, frame);
			frames.push(source);
			frames.at(-2)?.remove();
			section.append(source);
			await delay(20);
		}

		await settleMutationScan();
		assertSkipped(harness, frames.at(-1));
		assert.equal(countRequestsFor(harness, frames), 0);
		assertStableHeading(harness, stable, stableTranslation);

		const lateText = "A stable article loads beside the completed carousel.";
		const lateArticle = createElement(harness.document, "p", lateText);
		section.append(lateArticle);
		await waitFor(
			() =>
				Boolean(harness.getTranslation(lateArticle)) &&
				harness.statusText() === COMPLETE_TWO,
			"易变容器旁新增的稳定正文没有进入翻译",
		);
		assert.equal(harness.getTranslation(stable), stableTranslation);
		assert.equal(harness.requestCount(lateText), 1);
	} finally {
		harness.dispose();
	}
});

// 验证同文 fresh Element 重渲染保持稳定语义：最终有译文、云请求复用且完成数不累加。
test("相同稳定文本的 fresh Element 重渲染复用翻译", async () => {
	const sourceText = "A stable server-rendered paragraph keeps the same semantic content.";
	const harness = createContentHarness();
	try {
		const container = createElement(harness.document, "section");
		let source = createElement(harness.document, "p", sourceText);
		container.append(source);
		harness.root.append(container);
		harness.start();
		await waitFor(
			() => Boolean(harness.getTranslation(source)) && harness.statusText() === COMPLETE_ONE,
			"初始稳定正文没有完成翻译",
		);

		for (let render = 1; render <= CONTENT_VOLATILITY.changeLimit + 1; render += 1) {
			source = createElement(harness.document, "p", sourceText);
			container.replaceChildren(source);
			await delay(20);
		}

		await waitFor(
			() => harness.getTranslation(source)?.textContent === `译文：${sourceText}`,
			"同文 fresh Element 的最终译文没有恢复",
		);
		await settleMutationScan();
		assert.equal(harness.statusText(), COMPLETE_ONE);
		assert.equal(harness.requestCount(sourceText), 1);
		assert.equal(countRequestedSegments(harness), 1);
	} finally {
		harness.dispose();
	}
});

async function waitForStableHeading(harness, stable) {
	await waitFor(
		() => Boolean(harness.getTranslation(stable)) && harness.statusText() === COMPLETE_ONE,
		"稳定标题没有完成翻译",
	);
	return harness.getTranslation(stable);
}

function assertStableHeading(harness, stable, translation) {
	assert.equal(harness.getTranslation(stable), translation);
	assert.equal(translation.textContent, `译文：${STABLE_HEADING}`);
	assert.equal(harness.requestCount(STABLE_HEADING), 1);
	assert.equal(harness.statusText(), COMPLETE_ONE);
}

function assertSkipped(harness, source) {
	assert.equal(source.dataset.btSource, undefined);
	assert.equal(harness.getTranslation(source), null);
}

function assertVolatileCarousel(harness, frames) {
	assertSkipped(harness, frames.at(-1));
	assert.equal(harness.requestCount(frames.at(-1).textContent), 0);
	assert.equal(countRequestsFor(harness, frames.slice(1)), 0);
	assert.ok(countRequestsFor(harness, frames) <= 1);
	assert.equal(harness.statusText(), EMPTY_STATUS);
}

function createCarouselFrame(document, frame) {
	return createElement(document, "p", `A detached carousel renders frame ${frame}.`);
}

function createElement(document, tagName, text = "") {
	const element = document.createElement(tagName);
	element.textContent = text;
	return element;
}

function countRequestsFor(harness, sources) {
	return sources.reduce((total, source) => total + harness.requestCount(source.textContent), 0);
}

function countRequestsForTexts(harness, texts) {
	return texts.reduce((total, text) => total + harness.requestCount(text), 0);
}

function countRequestedSegments(harness) {
	return harness.translationRequests.reduce((total, request) => total + request.texts.length, 0);
}

function nextObserverTask() {
	return delay(30);
}

function settleMutationScan() {
	return delay(TIMING.mutationDebounce + TIMING.completionSettle + 80);
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

import assert from "node:assert/strict";
import test from "node:test";

import { TIMING } from "../../src/content/constants.js";
import { CONTENT_VOLATILITY } from "../../src/content/volatile-content-tracker.js";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const COMPLETE_FOUR = "双语翻译完成，已覆盖 4 个文本块";
const EMPTY_STATUS = "当前页面没有需要翻译的外语正文";
const WAIT_TIMEOUT = 5_000;

// 验证同一父容器中四条独立 fresh 替换链不会互相累计易变次数，最终覆盖数仍为四。
test("同一 section 的独立 fresh 替换链保持稳定", async () => {
	const harness = createContentHarness();
	try {
		const section = createElement(harness.document, "section");
		const initialTexts = createTexts("Initial stable paragraph", 4);
		const replacementTexts = createTexts("Updated stable paragraph", 4);
		let sources = initialTexts.map((text) => createElement(harness.document, "p", text));
		section.append(...sources);
		harness.root.append(section);
		harness.start();

		await waitForTranslations(harness, sources, "初始四段正文没有全部完成翻译");
		for (const [index, source] of sources.entries()) {
			const replacement = createElement(harness.document, "p", replacementTexts[index]);
			source.replaceWith(replacement);
			sources[index] = replacement;
			await waitForTranslation(
				harness,
				replacement,
				`第 ${index + 1} 条独立替换链被错误跳过`,
			);
		}

		await waitForStatus(harness, COMPLETE_FOUR, "独立替换链污染了最终覆盖数");
		for (const text of [...initialTexts, ...replacementTexts]) {
			assert.equal(harness.requestCount(text), 1);
		}
	} finally {
		harness.dispose();
	}
});

// 验证同一 section 中先后出现的 A、B 替换链分别达到阈值，B 不会因晚加入而逃逸或继承错误进度。
test("同一 section 的后续替换链也独立进入易变状态", async () => {
	const harness = createContentHarness();
	try {
		const section = createElement(harness.document, "section");
		let sourceA = createElement(harness.document, "p", "Chain A starts with stable text.");
		section.append(sourceA);
		harness.root.append(section);
		harness.start();
		await waitForTranslation(harness, sourceA, "链 A 初始正文没有完成翻译");

		const chainA = await driveTranslatedFreshChain(harness, sourceA, "Chain A frame");
		sourceA = chainA.source;
		assertPresentationCleared(harness, sourceA);

		let sourceB = createElement(harness.document, "p", "Chain B starts after A is volatile.");
		section.append(sourceB);
		await waitForTranslation(harness, sourceB, "晚加入的链 B 初始正文没有完成翻译");
		const chainB = await driveTranslatedFreshChain(
			harness,
			sourceB,
			"Chain B frame",
			1,
		);
		sourceB = chainB.source;

		await settleMutationScan();
		await waitForStatus(harness, EMPTY_STATUS, "A、B 易变历史没有从进度中回收");
		assertPresentationCleared(harness, sourceA);
		assertPresentationCleared(harness, sourceB);
		assert.ok(countRequestsFor(harness, chainA.texts) <= CONTENT_VOLATILITY.changeLimit);
		assert.ok(countRequestsFor(harness, chainB.texts) <= CONTENT_VOLATILITY.changeLimit);
		assert.ok(countRequestedSegments(harness) <= CONTENT_VOLATILITY.changeLimit * 2);
		assert.equal(harness.requestCount(chainB.texts.at(-1)), 0);
	} finally {
		harness.dispose();
	}
});

// 验证同一 X tweetText 内的 span 连续换文时，阈值前可逐帧翻译，阈值后完整清理 generated 呈现。
test("X tweetText 子 span 连续换文后清空 generated 呈现", async () => {
	const harness = createContentHarness();
	try {
		prepareXHarness(harness);
		const { article, source } = createTweet(
			harness.document,
			"A tweet begins with stable translated text.",
		);
		const hostDescription = createElement(harness.document, "span", "Host description");
		hostDescription.id = "host-description";
		hostDescription.setAttribute("translate", "no");
		source.setAttribute("aria-describedby", hostDescription.id);
		harness.root.append(article, hostDescription);
		harness.start();
		await waitForGenerated(harness, source, source.textContent, "初始 tweetText 没有译文");

		const descriptionIds = [source.dataset.btDescriptionId];
		const frameTexts = [];
		let span = source.firstElementChild;
		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit; frame += 1) {
			const text = `A tweet renders a different child frame ${frame}.`;
			frameTexts.push(text);
			const replacement = createElement(harness.document, "span", text);
			span.replaceWith(replacement);
			span = replacement;
			if (frame < CONTENT_VOLATILITY.changeLimit) {
				await waitForGenerated(harness, source, text, `X 子节点第 ${frame} 帧没有完成翻译`);
				descriptionIds.push(source.dataset.btDescriptionId);
			}
		}

		span.replaceWith(createElement(harness.document, "span", "A skipped tweet tail frame."));
		await settleMutationScan();
		await waitForStatus(harness, EMPTY_STATUS, "X 易变子节点仍残留完成进度");
		assertGeneratedCleared(harness, source, descriptionIds);
		assert.equal(source.getAttribute("aria-describedby"), hostDescription.id);
		assert.ok(countRequestedSegments(harness) <= CONTENT_VOLATILITY.changeLimit);
		assert.equal(harness.requestCount(frameTexts.at(-1)), 0);
	} finally {
		harness.dispose();
	}
});

// 验证 X 同文 fresh surface 迁移后，新 source 快速换文达到阈值时会一并回收迁移来的进度。
test("X 同文 surface 迁移后的快速换文回收全部进度", async () => {
	const sourceText = "A fresh tweet surface keeps the same initial meaning.";
	const harness = createContentHarness();
	try {
		prepareXHarness(harness);
		const tweet = createTweet(harness.document, sourceText);
		harness.root.append(tweet.article);
		harness.start();
		await waitForGenerated(harness, tweet.source, sourceText, "初始 X surface 没有译文");
		const descriptionId = tweet.source.dataset.btDescriptionId;

		const replacement = createTweetText(harness.document, sourceText);
		tweet.source.replaceWith(replacement);
		await nextMutationTurn();
		assert.equal(replacement.dataset.btTranslation, `译文：${sourceText}`);
		assert.equal(replacement.dataset.btDescriptionId, descriptionId);
		assert.equal(harness.requestCount(sourceText), 1);

		const changedTexts = [];
		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit + 2; frame += 1) {
			const text = `A migrated tweet changes rapidly at frame ${frame}.`;
			changedTexts.push(text);
			replacement.textContent = text;
			await delay(20);
		}

		await settleMutationScan();
		await waitForStatus(harness, EMPTY_STATUS, "迁移后的旧进度没有在易变阈值后归零");
		assertGeneratedCleared(harness, replacement, [descriptionId]);
		assert.equal(countRequestsFor(harness, changedTexts), 0);
		assert.equal(countRequestedSegments(harness), 1);
	} finally {
		harness.dispose();
	}
});

async function driveTranslatedFreshChain(harness, initialSource, label, extraFrames = 0) {
	let source = initialSource;
	const texts = [initialSource.textContent];
	const frameCount = CONTENT_VOLATILITY.changeLimit + extraFrames;
	for (let frame = 1; frame <= frameCount; frame += 1) {
		const text = `${label} ${frame} has different content.`;
		texts.push(text);
		const replacement = createElement(harness.document, "p", text);
		source.replaceWith(replacement);
		source = replacement;
		if (frame < CONTENT_VOLATILITY.changeLimit) {
			await waitForTranslation(harness, source, `${label} ${frame} 没有完成翻译`);
		} else if (frame === CONTENT_VOLATILITY.changeLimit) {
			await nextMutationTurn();
			assertPresentationCleared(harness, source);
		}
	}
	await nextMutationTurn();
	await waitFor(() => isPresentationCleared(harness, source), `${label} 没有进入易变状态`, WAIT_TIMEOUT);
	return { source, texts };
}

function createTweet(document, text) {
	const article = createElement(document, "article");
	article.dataset.testid = "tweet";
	const source = createTweetText(document, text);
	article.append(source);
	return { article, source };
}

function createTweetText(document, text) {
	const source = createElement(document, "div");
	source.dataset.testid = "tweetText";
	source.append(createElement(document, "span", text));
	return source;
}

function prepareXHarness(harness) {
	harness.window.location.href = "https://x.com/home";
	harness.document.documentElement.lang = "en";
}

async function waitForTranslations(harness, sources, message) {
	await waitFor(
		() => sources.every((source) => Boolean(harness.getTranslation(source))),
		message,
		WAIT_TIMEOUT,
	);
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

async function waitForStatus(harness, expected, message) {
	await waitFor(() => harness.statusText() === expected, message, WAIT_TIMEOUT);
}

function assertPresentationCleared(harness, source) {
	assert.equal(isPresentationCleared(harness, source), true);
}

function isPresentationCleared(harness, source) {
	return source.dataset.btSource === undefined && harness.getTranslation(source) === null;
}

function assertGeneratedCleared(harness, source, descriptionIds) {
	assert.equal(source.dataset.btSource, undefined);
	assert.equal(source.dataset.btPresentation, undefined);
	assert.equal(source.dataset.btPresentationRun, undefined);
	assert.equal(source.dataset.btTranslation, undefined);
	assert.equal(source.dataset.btTranslationLang, undefined);
	assert.equal(source.dataset.btDescriptionId, undefined);
	for (const descriptionId of descriptionIds) {
		assert.equal(harness.document.getElementById(descriptionId), null);
	}
}

function createTexts(prefix, count) {
	return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}.`);
}

function createElement(document, tagName, text = "") {
	const element = document.createElement(tagName);
	element.textContent = text;
	return element;
}

function countRequestsFor(harness, texts) {
	return texts.reduce((total, text) => total + harness.requestCount(text), 0);
}

function countRequestedSegments(harness) {
	return harness.translationRequests.reduce((total, request) => total + request.texts.length, 0);
}

function nextMutationTurn() {
	return delay(30);
}

function settleMutationScan() {
	return delay(TIMING.mutationDebounce + TIMING.completionSettle + 100);
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

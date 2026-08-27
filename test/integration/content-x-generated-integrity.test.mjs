import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";
import {
	assertGeneratedTranslation,
	assertHostNodes,
	assertSelectableTranslation,
	getGeneratedTranslation,
	getGeneratedTranslationInner,
} from "../helpers/generated-translation-assertions.mjs";

const SOURCE_TEXT = "A generated translation must survive hostile host mutations.";
const TRANSLATION_TEXT = `译文：${SOURCE_TEXT}`;
const GENERATED_MARKER_SELECTOR = [
	".bt-translation",
	"[data-bt-owned]",
	"[data-bt-run]",
].join(", ");

const TRANSLATION_CORRUPTIONS = [
	{
		name: "class 被改写",
		apply(translation) {
			translation.className = "host-overwritten-translation";
		},
	},
	{
		name: "data-bt-owned 被移除",
		apply(translation) {
			delete translation.dataset.btOwned;
		},
	},
	{
		name: "data-bt-run 被改写",
		apply(translation) {
			translation.dataset.btRun = "host-run";
		},
	},
	{
		name: "lang 被改写",
		apply(translation) {
			translation.lang = "fr";
		},
	},
	{
		name: "translate 被改写",
		apply(translation) {
			translation.setAttribute("translate", "yes");
		},
	},
	{
		name: "id 被改写",
		apply(translation) {
			translation.id = "host-overwritten-translation-id";
		},
	},
	{
		name: "Text.data 被改写",
		apply(translation) {
			getGeneratedTranslationInner(translation).firstChild.data =
				"宿主写入的错误译文";
		},
	},
	{
		name: "inner 被替换",
		apply(translation) {
			translation.lastChild.replaceWith(
				translation.ownerDocument.createElement("span"),
			);
		},
	},
];

// 验证宿主逐项破坏真实译文后，系统恢复唯一、同语义、可选择的规范节点并能完整停止。
test("X generated 译文修复宿主对节点属性与文本的破坏", async (context) => {
	for (const corruption of TRANSLATION_CORRUPTIONS) {
		await context.test(corruption.name, async () => {
			const harness = createContentHarness();
			try {
				harness.window.location.href = "https://x.com/home";
				const source = createTweetText(harness.document, SOURCE_TEXT);
				const originalHostNodes = [...source.childNodes];
				harness.root.append(source);
				harness.start();
				await waitFor(
					() => source.dataset.btTranslation === TRANSLATION_TEXT,
					"初始 X 真实译文没有生成",
				);
				const damagedNode = assertCanonicalTranslation(
					harness,
					source,
					originalHostNodes,
				);

				corruption.apply(damagedNode);
				await waitFor(
					() => hasCanonicalTranslation(source, TRANSLATION_TEXT),
					`${corruption.name} 后没有恢复规范译文`,
					1_000,
				);
				const restoredNode = assertCanonicalTranslation(
					harness,
					source,
					originalHostNodes,
				);
				if (restoredNode !== damagedNode) {
					assert.equal(damagedNode.isConnected, false);
				}

				await stopHarness(harness);
				assertGeneratedStateRemoved(source);
				assert.equal(restoredNode.isConnected, false);
				assert.equal(damagedNode.isConnected, false);
				assertHostNodes(source, originalHostNodes);
			} finally {
				harness.dispose();
			}
		});
	}
});

// 验证 fresh replacement 把 cloned 译文包进宿主 wrapper 时，只迁移原 canonical 节点且 ID 唯一。
test("X wrapped cloned generated child 不会与迁移节点并存", async () => {
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		const source = createTweetText(harness.document, SOURCE_TEXT);
		harness.root.append(source);
		harness.start();
		await waitFor(
			() => source.dataset.btTranslation === TRANSLATION_TEXT,
			"初始 X 真实译文没有生成",
		);
		const canonicalNode = assertGeneratedTranslation(source, TRANSLATION_TEXT);
		const canonicalInner = getGeneratedTranslationInner(canonicalNode);
		const canonicalTextNode = canonicalInner.firstChild;
		const canonicalId = canonicalNode.id;
		const clonedNode = canonicalNode.cloneNode(true);
		const replacement = createWrappedReplacement(
			harness.document,
			source.firstElementChild,
			clonedNode,
		);

		source.replaceWith(replacement);
		await waitFor(
			() =>
				replacement.dataset.btDescriptionId === canonicalId &&
				replacement.contains(canonicalNode),
			"wrapped fresh replacement 没有迁移 canonical 译文",
		);

		assert.equal(assertGeneratedTranslation(replacement, TRANSLATION_TEXT), canonicalNode);
		assert.equal(getGeneratedTranslationInner(canonicalNode), canonicalInner);
		assert.equal(canonicalInner.firstChild, canonicalTextNode);
		assertSelectableTranslation(harness.window, canonicalNode, TRANSLATION_TEXT);
		assert.deepEqual(findGeneratedDescendants(replacement), [canonicalNode]);
		assert.deepEqual(findElementsWithId(harness.document, canonicalId), [canonicalNode]);
		assert.equal(clonedNode.isConnected, false);
		assert.equal(harness.requestCount(SOURCE_TEXT), 1);

		await stopHarness(harness);
		assertGeneratedStateRemoved(replacement);
		assert.equal(canonicalNode.isConnected, false);
	} finally {
		harness.dispose();
	}
});

function createTweetText(document, text) {
	const source = document.createElement("div");
	source.dataset.testid = "tweetText";
	const textContainer = document.createElement("span");
	textContainer.textContent = text;
	source.append(textContainer);
	return source;
}

function createWrappedReplacement(document, hostContent, clonedTranslation) {
	const replacement = document.createElement("div");
	replacement.dataset.testid = "tweetText";
	const wrapper = document.createElement("span");
	wrapper.className = "host-content-wrapper";
	wrapper.append(hostContent.cloneNode(true), clonedTranslation);
	replacement.append(wrapper);
	return replacement;
}

function hasCanonicalTranslation(source, expectedText) {
	const translation = getGeneratedTranslation(source);
	const inner = getGeneratedTranslationInner(translation);
	return Boolean(
		translation &&
		source.contains(translation) &&
		translation.className ===
			"bt-translation bt-translation-generated notranslate" &&
		translation.dataset.btOwned === "true" &&
		translation.dataset.btRun === source.dataset.btPresentationRun &&
		source.dataset.btSource === source.dataset.btPresentationRun &&
		source.dataset.btGeneratedOwned === "true" &&
		translation.lang === "zh-CN" &&
		source.dataset.btTranslationLang === translation.lang &&
		translation.getAttribute("translate") === "no" &&
		!translation.hasAttribute("aria-hidden") &&
		translation.id === source.dataset.btDescriptionId &&
		translation.childNodes.length === 2 &&
		translation.firstChild?.matches?.("br.bt-translation-break") &&
		translation.lastChild === inner &&
		inner?.className === "bt-translation-inner notranslate" &&
		inner.lang === "zh-CN" &&
		inner.childNodes.length === 1 &&
		inner.firstChild?.data === expectedText &&
		source.dataset.btTranslation === expectedText &&
		findGeneratedMarkers(source).length === 1 &&
		findElementsWithId(source.ownerDocument, translation.id).length === 1
	);
}

function assertCanonicalTranslation(harness, source, originalHostNodes) {
	const translation = assertGeneratedTranslation(source, TRANSLATION_TEXT);
	assert.equal(hasCanonicalTranslation(source, TRANSLATION_TEXT), true);
	assertSelectableTranslation(harness.window, translation, TRANSLATION_TEXT);
	assertHostNodes(source, originalHostNodes, translation);
	return translation;
}

function findGeneratedMarkers(source) {
	return [...source.querySelectorAll(GENERATED_MARKER_SELECTOR)];
}

function findGeneratedDescendants(source) {
	return [
		...source.querySelectorAll(
			".bt-translation-generated[data-bt-owned='true']",
		),
	];
}

function findElementsWithId(document, id) {
	return [...document.querySelectorAll("[id]")].filter((element) => element.id === id);
}

function assertGeneratedStateRemoved(source) {
	assert.deepEqual(
		source.getAttributeNames().filter((name) => name.startsWith("data-bt-")),
		[],
	);
	assert.equal(source.querySelector(GENERATED_MARKER_SELECTOR), null);
}

async function stopHarness(harness) {
	harness.injectAgain();
	await waitFor(
		() => harness.messages.some(({ type }) => type === "CANCEL_RUN"),
		"停止运行没有取消 X generated 翻译任务",
	);
}

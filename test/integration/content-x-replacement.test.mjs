import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

// 验证 X 用同文新节点替换正文时，译文在下一次绘制前迁移而不是延迟重建。
test("X fresh source replacement 不产生译文缺口", async () => {
	const sourceText = "A React replacement keeps the same bilingual surface.";
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		harness.document.documentElement.lang = "en";
		const article = createElement(harness.document, "article");
		const source = createElement(harness.document, "div", sourceText);
		source.dataset.testid = "tweetText";
		source.setAttribute("aria-describedby", "old-host-description");
		article.append(source);
		harness.root.append(article);

		harness.start();
		await waitFor(() => Boolean(source.dataset.btTranslation), "初始 X 译文没有生成");
		const translation = source.dataset.btTranslation;
		const descriptionId = source.dataset.btDescriptionId;
		const replacement = createElement(harness.document, "div", sourceText);
		replacement.dataset.testid = "tweetText";
		replacement.setAttribute("aria-describedby", "new-host-description");

		source.replaceWith(replacement);
		await nextMutationTurn();
		assert.equal(replacement.dataset.btTranslation, translation);
		assert.equal(replacement.dataset.btDescriptionId, descriptionId);
		assert.equal(
			replacement.getAttribute("aria-describedby"),
			`new-host-description ${descriptionId}`,
		);
		assert.equal(source.getAttribute("aria-describedby"), "old-host-description");
		assert.equal(source.dataset.btTranslation, undefined);
		assert.equal(harness.requestCount(sourceText), 1);

		await new Promise((resolve) => setTimeout(resolve, 350));
		assert.equal(replacement.dataset.btDescriptionId, descriptionId);
		assert.equal(harness.requestCount(sourceText), 1);

		const replacementArticle = createElement(harness.document, "article");
		const nestedReplacement = createElement(harness.document, "div", sourceText);
		nestedReplacement.dataset.testid = "tweetText";
		replacementArticle.append(nestedReplacement);
		article.replaceWith(replacementArticle);
		await waitFor(
			() => nestedReplacement.dataset.btDescriptionId === descriptionId,
			"嵌套 X replacement 没有完成原子迁移",
		);
		assert.equal(nestedReplacement.dataset.btTranslation, translation);
		assert.equal(nestedReplacement.dataset.btDescriptionId, descriptionId);

		stripGeneratedAttributes(nestedReplacement);
		const strippedReplacement = createElement(harness.document, "div", sourceText);
		strippedReplacement.dataset.testid = "tweetText";
		nestedReplacement.replaceWith(strippedReplacement);
		await waitFor(
			() => strippedReplacement.dataset.btDescriptionId === descriptionId,
			"属性被宿主清理后，fresh replacement 没有恢复迁移",
		);
		assert.equal(strippedReplacement.dataset.btTranslation, translation);
		assert.equal(strippedReplacement.dataset.btDescriptionId, descriptionId);

		const changedText = "A replacement with different text must be translated anew.";
		const changedSource = createElement(harness.document, "div", changedText);
		changedSource.dataset.testid = "tweetText";
		strippedReplacement.replaceWith(changedSource);
		await nextMutationTurn();
		assert.equal(changedSource.dataset.btTranslation, undefined);
		await waitFor(
			() => changedSource.dataset.btTranslation === `译文：${changedText}`,
			"不同原文错误继承了旧译文",
		);
		assert.notEqual(changedSource.dataset.btDescriptionId, descriptionId);
		assert.equal(harness.requestCount(changedText), 1);

		await assertRightRailReplacement(harness);
		await assertRepeatedReplacement(harness);
		await assertReorderedReplacement(harness);
		await assertLanguageBoundary(harness);
	} finally {
		harness.dispose();
	}
});

async function assertRightRailReplacement(harness) {
	const sidebar = createElement(harness.document, "aside");
	const trendRow = createElement(harness.document, "a");
	trendRow.setAttribute("role", "link");
	const trendMeta = createElement(harness.document, "p", "Trending in United States");
	const trendTitle = createElement(harness.document, "h3", "Mackinac Island");
	trendRow.append(trendMeta, trendTitle);
	sidebar.append(trendRow);
	harness.root.append(sidebar);
	await waitFor(
		() => Boolean(trendMeta.dataset.btTranslation && trendTitle.dataset.btTranslation),
		"X 右栏趋势内容没有生成译文",
	);
	const descriptionIds = [trendMeta, trendTitle].map(
		(source) => source.dataset.btDescriptionId,
	);
	const replacement = trendRow.cloneNode(true);
	for (const source of replacement.querySelectorAll("p, h3")) {
		stripGeneratedAttributes(source);
	}
	trendRow.replaceWith(replacement);
	await waitFor(
		() =>
			[...replacement.querySelectorAll("p, h3")].every(
				(source, index) => source.dataset.btDescriptionId === descriptionIds[index],
			),
		"X 右栏 generated replacement 没有完成迁移",
	);
	assert.deepEqual(
		[...replacement.querySelectorAll("p, h3")].map(
			(source) => source.dataset.btDescriptionId,
		),
		descriptionIds,
	);
}

async function assertRepeatedReplacement(harness) {
	const text = "Repeated trend label with an identical translation.";
	const container = createElement(harness.document, "section");
	const sources = [
		createElement(harness.document, "p", text),
		createElement(harness.document, "p", text),
	];
	container.append(...sources);
	harness.root.append(container);
	await waitFor(
		() => sources.every((source) => source.dataset.btDescriptionId),
		"重复 X 内容没有生成译文",
	);
	const descriptionIds = sources.map((source) => source.dataset.btDescriptionId);
	const replacements = sources.map(() => createElement(harness.document, "p", text));
	container.replaceChildren(...replacements);
	await waitFor(
		() =>
			replacements.every(
				(source, index) => source.dataset.btDescriptionId === descriptionIds[index],
			),
		"重复 generated replacement 没有完成一一迁移",
	);
	assert.deepEqual(
		replacements.map((source) => source.dataset.btDescriptionId),
		descriptionIds,
	);
}

async function assertReorderedReplacement(harness) {
	const texts = [
		"The first generated surface keeps its own replacement identity.",
		"The second generated surface can move ahead of the first one.",
	];
	const container = createElement(harness.document, "section");
	const sources = texts.map((text) => createElement(harness.document, "p", text));
	container.append(...sources);
	harness.root.append(container);
	await waitFor(
		() => sources.every((source) => source.dataset.btDescriptionId),
		"待重排的 X 内容没有生成译文",
	);
	const descriptionByText = new Map(
		sources.map((source) => [source.textContent, source.dataset.btDescriptionId]),
	);
	const replacements = [...texts]
		.reverse()
		.map((text) => createElement(harness.document, "p", text));

	container.replaceChildren(...replacements);
	await waitFor(
		() =>
			replacements.every(
				(replacement) =>
					replacement.dataset.btDescriptionId ===
					descriptionByText.get(replacement.textContent),
			),
		"重排 generated replacement 没有按文本身份迁移",
	);

	for (const replacement of replacements) {
		assert.equal(
			replacement.dataset.btDescriptionId,
			descriptionByText.get(replacement.textContent),
		);
		assert.equal(replacement.dataset.btTranslation, `译文：${replacement.textContent}`);
		assert.equal(harness.requestCount(replacement.textContent), 1);
	}
}

async function assertLanguageBoundary(harness) {
	const text = "Language semantics must remain part of replacement identity.";
	const englishSource = createElement(harness.document, "p", text);
	englishSource.lang = "en";
	harness.root.append(englishSource);
	await waitFor(() => Boolean(englishSource.dataset.btTranslation), "英语正文没有译文");
	const chineseSource = createElement(harness.document, "p", text);
	chineseSource.lang = "zh";
	englishSource.replaceWith(chineseSource);
	await nextMutationTurn();
	assert.equal(chineseSource.dataset.btTranslation, undefined);
}

function stripGeneratedAttributes(source) {
	for (const name of [...source.getAttributeNames()]) {
		if (name.startsWith("data-bt-") || name === "aria-describedby") {
			source.removeAttribute(name);
		}
	}
}

function createElement(document, tagName, text = "") {
	const element = document.createElement(tagName);
	element.textContent = text;
	return element;
}

function nextMutationTurn() {
	return new Promise((resolve) => setTimeout(resolve, 30));
}

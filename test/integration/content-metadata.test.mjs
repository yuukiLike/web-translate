import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

function appendElement(document, parent, tagName, text, attributes = {}) {
	const element = document.createElement(tagName);
	element.textContent = text;
	for (const [name, value] of Object.entries(attributes)) {
		element.setAttribute(name, value);
	}
	parent.append(element);
	return element;
}

function requestedTexts(harness) {
	return harness.translationRequests.flatMap(({ texts }) => texts);
}

// 验证默认策略过滤数字、技术标识、社交元数据及三片段以内的英文链接和按钮。
test("默认内容过滤策略只提交有翻译价值的候选", async () => {
	const harness = createContentHarness();
	try {
		const author = appendElement(
			harness.document,
			harness.root,
			"div",
			"Xu Dong @xudong8834",
			{ "data-testid": "User-Name" },
		);
		const authorLink = appendElement(harness.document, harness.root, "a", "John Smith", {
			rel: "author",
		});
		const timestamp = appendElement(harness.document, harness.root, "time", "Yesterday", {
			datetime: "2026-08-06T10:00:00+08:00",
		});
		const compactMinute = appendElement(harness.document, harness.root, "time", "15m");
		const decoratedTime = appendElement(harness.document, harness.root, "div", "");
		decoratedTime.append("· ");
		const decoratedTimeValue = appendElement(harness.document, decoratedTime, "time", "4h");
		decoratedTimeValue.style.display = "inline";
		const handle = appendElement(harness.document, harness.root, "a", "@xudong8834");
		const compactTime = appendElement(harness.document, harness.root, "div", "4h");
		const technicalRepository = appendElement(
			harness.document,
			harness.root,
			"div",
			"yuukiLike/cc-md-vault",
		);
		const technicalFile = appendElement(harness.document, harness.root, "div", "README.md");
		const numberDisplay = appendElement(harness.document, harness.root, "div", "144");
		const shortUsername = appendElement(harness.document, harness.root, "a", "Xu Dong");
		const shortLink = appendElement(harness.document, harness.root, "a", "Read useful docs");
		const shortButton = appendElement(harness.document, harness.root, "button", "Try it now");
		const roleLink = appendElement(harness.document, harness.root, "div", "cc-md-vault", {
			role: "link",
		});
		const roleButton = appendElement(harness.document, harness.root, "div", "Open docs now", {
			role: "button",
		});
		const descriptiveLink = appendElement(
			harness.document,
			harness.root,
			"a",
			"Read complete project docs",
		);
		const descriptiveButton = appendElement(
			harness.document,
			harness.root,
			"button",
			"Please try this action",
		);
		const nonAsciiLink = appendElement(harness.document, harness.root, "a", "Résumé docs");
		const body = harness.addArticle("Thanks @xudong8834 — 4h battery life.");
		const expectedRequests = [
			descriptiveLink.textContent,
			descriptiveButton.textContent,
			nonAsciiLink.textContent,
			body.source.textContent,
		];
		harness.start();

		await waitFor(
			() =>
				Boolean(harness.getTranslation(descriptiveLink)) &&
				Boolean(harness.getTranslation(descriptiveButton)) &&
				Boolean(harness.getTranslation(nonAsciiLink)) &&
				Boolean(harness.getTranslation(body.source)),
			"正文或保留的交互候选没有生成译文",
		);
		await new Promise((resolve) => setTimeout(resolve, 230));

		assert.deepEqual(
			requestedTexts(harness).sort(),
			expectedRequests.sort(),
		);
		for (const metadata of [
			author,
			authorLink,
			timestamp,
			compactMinute,
			decoratedTime,
			handle,
			compactTime,
			technicalRepository,
			technicalFile,
			numberDisplay,
			shortUsername,
			shortLink,
			shortButton,
			roleLink,
			roleButton,
		]) {
			assert.equal(metadata.dataset.btSource, undefined);
		}
	} finally {
		harness.dispose();
	}
});

// 验证内嵌时间、作者和 datetime 内容仍作为正文的一部分完整提交。
test("正文中的元数据语义不会被静默删除", async () => {
	const harness = createContentHarness();
	try {
		const timeParagraph = appendElement(harness.document, harness.root, "p", "");
		timeParagraph.append("We met ");
		appendElement(harness.document, timeParagraph, "time", "yesterday", {
			datetime: "2026-08-05",
		});
		timeParagraph.append(" and fixed the bug.");

		const authorParagraph = appendElement(harness.document, harness.root, "p", "");
		authorParagraph.append("Written by ");
		appendElement(harness.document, authorParagraph, "a", "Jane Doe", { rel: "author" });
		authorParagraph.append(" for the project.");

		const updateParagraph = appendElement(harness.document, harness.root, "p", "");
		appendElement(harness.document, updateParagraph, "ins", "Important product update", {
			datetime: "2026-08-06",
		});
		const authorProfile = appendElement(harness.document, harness.root, "div", "", {
			itemprop: "author",
		});
		appendElement(harness.document, authorProfile, "span", "Jane Doe", { itemprop: "name" });
		const authorBio = appendElement(
			harness.document,
			authorProfile,
			"p",
			"Writes practical engineering articles.",
		);
		const inlineControls = appendElement(harness.document, harness.root, "p", "");
		inlineControls.append("Use ");
		appendElement(harness.document, inlineControls, "a", "Read docs");
		inlineControls.append(" or ");
		appendElement(harness.document, inlineControls, "button", "Try now");
		inlineControls.append(" to continue.");
		const heading = appendElement(harness.document, harness.root, "h2", "Yesterday");
		const sources = [
			timeParagraph,
			authorParagraph,
			updateParagraph,
			authorBio,
			inlineControls,
			heading,
		];
		harness.start();

		await waitFor(
			() => sources.every((source) => Boolean(harness.getTranslation(source))),
			"内嵌语义正文没有全部生成译文",
		);
		assert.deepEqual(requestedTexts(harness).sort(), sources.map(({ textContent }) => textContent).sort());
	} finally {
		harness.dispose();
	}
});

// 验证关闭全部可选过滤后四类候选恢复翻译，而数字展示和 URL 仍由核心规则跳过。
test("可选内容过滤可以关闭且不影响始终过滤规则", async () => {
	const harness = createContentHarness({
		contentFilters: {
			skipTechnicalIdentifiers: false,
			skipSocialMetadata: false,
			skipShortLinks: false,
			skipShortButtons: false,
		},
	});
	try {
		const technicalRepository = appendElement(
			harness.document,
			harness.root,
			"div",
			"yuukiLike/cc-md-vault",
		);
		const socialHandle = appendElement(harness.document, harness.root, "div", "@xudong8834");
		const timestamp = appendElement(harness.document, harness.root, "time", "Yesterday", {
			datetime: "2026-08-06T10:00:00+08:00",
		});
		const shortLink = appendElement(harness.document, harness.root, "a", "Read docs");
		const shortButton = appendElement(harness.document, harness.root, "button", "Try now");
		const roleLink = appendElement(harness.document, harness.root, "div", "cc-md-vault", {
			role: "link",
		});
		const roleButton = appendElement(harness.document, harness.root, "div", "Open docs", {
			role: "button",
		});
		const numberDisplay = appendElement(harness.document, harness.root, "div", "1.6K");
		const url = appendElement(harness.document, harness.root, "div", "https://example.com/docs");
		const restoredSources = [
			technicalRepository,
			socialHandle,
			timestamp,
			shortLink,
			shortButton,
			roleLink,
			roleButton,
		];
		const expectedRequests = restoredSources.map(({ textContent }) => textContent);
		harness.start();

		await waitFor(
			() => restoredSources.every((source) => Boolean(harness.getTranslation(source))),
			"关闭过滤后没有恢复全部可选候选",
		);
		assert.deepEqual(
			requestedTexts(harness).sort(),
			expectedRequests.sort(),
		);
		assert.equal(harness.requestCount(numberDisplay.textContent), 0);
		assert.equal(harness.requestCount(url.textContent), 0);
		assert.equal(numberDisplay.dataset.btSource, undefined);
		assert.equal(url.dataset.btSource, undefined);
	} finally {
		harness.dispose();
	}
});

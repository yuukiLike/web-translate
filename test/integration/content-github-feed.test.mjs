import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const TITLE = "refactor(gateway): typed internal agent turn path for recovery";
const ISSUE_NUMBER = "#121223";
const TITLE_TRANSLATION = "重构（网关）：用于恢复的强类型内部代理转向路径 #121223";
const FEED_CHROME_TEXT = [
	"steipete",
	"contributed to",
	"openclaw/openclaw",
	"4 minutes ago",
	"Feed item options",
	"Show less like this",
	"I don't want to see openclaw/openclaw",
	"I want to see fewer merged pull requests",
	"Submit",
	"Merged",
	"steipete merged 2 commits",
];

// GitHub feed 的紧凑元信息不翻译，PR 标题译文仍属于原链接。
test("GitHub feed 保持卡片布局和标题链接语义", async () => {
	const harness = createContentHarness({
		contentFilters: {
			skipShortLinks: false,
			skipSocialMetadata: false,
			skipTechnicalIdentifiers: false,
		},
		translateText,
	});
	try {
		harness.window.location.href = "https://github.com/";
		const card = createFeedCard(harness.document);
		harness.root.append(card.feed);
		harness.start();

		await waitFor(
			() => Boolean(harness.getTranslation(card.bodyText)),
			"GitHub feed 正文没有翻译",
		);
		assertFeedChromeUntouched(harness, card);
		assertTitlePlacement(harness, card, true);
		assert.deepEqual(allRequestedTexts(harness).toSorted(), [
			`${TITLE} ${ISSUE_NUMBER}`,
			card.bodyHeading.textContent,
			card.inlineBody.textContent,
			card.bodyText.textContent,
		].toSorted());
		const inlineTranslation = harness.getTranslation(card.inlineBody);
		assert.equal(inlineTranslation.parentElement === card.inlineLink, false);
		assert.equal(inlineTranslation.previousElementSibling === card.inlineBody, true);
	} finally {
		harness.dispose();
	}
});

// 动态卡片继续应用 GitHub 边界，且相同结构不会误伤其他主机名。
test("GitHub feed 规则覆盖动态内容并隔离主机名", async () => {
	for (const [url, expectChromeTranslation] of [
		["https://github.com/", false],
		["https://example.com/", true],
		["https://github.com.evil.test/", true],
	]) {
		const harness = createContentHarness({
			contentFilters: {
				skipShortLinks: false,
				skipSocialMetadata: false,
				skipTechnicalIdentifiers: false,
			},
			translateText,
		});
		try {
			harness.window.location.href = url;
			const feed = createFeedRoot(harness.document);
			harness.root.append(feed);
			harness.start();

			const card = createFeedCard(harness.document);
			feed.querySelector("#conduit-feed-frame").append(card.article);
			await waitFor(
				() => Boolean(harness.getTranslation(card.bodyText)),
				`${url} 的动态 GitHub feed fixture 没有完成扫描`,
			);
			const dynamicActionText = "I want to see fewer merged pull requests";
			const dynamicAction = harness.document.createElement("button");
			dynamicAction.textContent = dynamicActionText;
			const dynamicBody = harness.document.createElement("p");
			dynamicBody.textContent = "Additional pull request context loaded dynamically.";
			card.feedHeading.append(dynamicAction);
			card.body.append(dynamicBody);
			await waitFor(
				() => Boolean(harness.getTranslation(dynamicBody)),
				`${url} 的动态正文哨兵没有翻译`,
			);
			if (expectChromeTranslation) {
				await waitFor(
					() => hasRequestedText(harness, dynamicActionText),
					`${url} 的站点隔离反例没有进入通用扫描`,
				);
			}
			assert.equal(
				hasRequestedText(harness, "contributed to"),
				expectChromeTranslation,
			);
			assert.equal(
				hasRequestedText(harness, dynamicActionText),
				expectChromeTranslation,
			);
			assert.equal(
				hasRequestedText(harness, "steipete merged 2 commits"),
				expectChromeTranslation,
			);
			assert.equal(
				hasRequestedText(harness, "I want to see fewer merged pull requests"),
				expectChromeTranslation,
			);
			if (!expectChromeTranslation) {
				assertFeedChromeUntouched(harness, card);
			}
			assertTitlePlacement(harness, card, !expectChromeTranslation);
			if (!expectChromeTranslation) {
				const linkedTranslation = harness.getTranslation(card.title);
				card.issueLink.href = "/openclaw/openclaw/pull/999999";
				await waitFor(() => {
					const current = harness.getTranslation(card.title);
					return Boolean(current && current !== linkedTranslation && !current.closest("a"));
				}, "href hydration 后标题译文仍错误归属于原链接");

				card.article.classList.remove("js-feed-item-component");
				await waitFor(
					() => Boolean(harness.getTranslation(card.attribution)),
					"移除 feed 边界后没有恢复通用扫描",
				);
				card.article.classList.add("js-feed-item-component");
				await waitFor(
					() => !harness.getTranslation(card.attribution),
					"恢复 feed 边界后仍残留 attribution 译文",
				);
				card.status.setAttribute("aria-label", "pull request information 0");
				await waitFor(
					() => Boolean(harness.getTranslation(card.status)),
					"移除状态边界后没有恢复通用扫描",
				);
				card.status.setAttribute("aria-label", "pull request details 0");
				await waitFor(
					() => !harness.getTranslation(card.status),
					"恢复状态边界后仍残留状态译文",
				);
				const relocatedSummary = card.relocatedDialog.querySelector("summary");
				const relocatedPanel = card.relocatedDialog.querySelector("details-dialog");
				relocatedPanel.remove();
				await waitFor(() => Boolean(harness.getTranslation(relocatedSummary)));
				card.relocatedDialog.append(relocatedPanel);
				await waitFor(() => !harness.getTranslation(relocatedSummary));
			} else {
				card.issueLink.remove();
				await waitFor(() => harness.getTranslation(card.title)?.parentElement === card.titleLink);
				card.titleLink.removeAttribute("href");
				await waitFor(() => {
					const translation = harness.getTranslation(card.title);
					return Boolean(translation && !translation.closest("a"));
				});
			}
		} finally {
			harness.dispose();
		}
	}
});

function createFeedCard(document) {
	const article = document.createElement("article");
	article.className = "Box js-feed-item-component";
	article.innerHTML = `
		<header>
			<h3 style="display:flex">
				<span>
					<a data-hovercard-type="user" href="/steipete">steipete</a>
					contributed to
					<a data-hovercard-type="repository" href="/openclaw/openclaw">openclaw/openclaw</a>
				</span>
				<button aria-label="Feed item options" class="feed-item-heading-menu-button">Feed item options</button>
			</h3>
			<h4><relative-time datetime="2026-08-09T20:34:41Z">4 minutes ago</relative-time></h4>
			<details id="feed-disinterest-dialog-121223">
				<summary>Show less like this</summary>
				<details-dialog class="js-feed-item-disinterest-dialog" role="dialog">
					<button>Show less like this</button>
					<button>I don't want to see openclaw/openclaw</button>
					<button>Submit</button>
				</details-dialog>
			</details>
		</header>
		<h3 class="feed-pr-title"></h3>
		<section aria-label="pull request details 0" style="display:flex">
			<span><svg class="octicon octicon-git-merge"></svg>Merged</span>
			<span>steipete merged 2 commits</span>
		</section>
		<details class="relocated-feed-dialog">
			<summary>I want to see fewer merged pull requests</summary>
			<details-dialog class="js-feed-item-disinterest-dialog" role="dialog">
				<button>Submit</button>
			</details-dialog>
		</details>
		<section aria-label="pull request body preview 0" class="markdown-body">
			<h2>What Problem This Solves</h2>
			<p>The gateway uses a stable internal path for recovery.</p>
			<p class="inline-link-prose">Read the <a href="/openclaw/openclaw/docs">complete recovery guide</a> before continuing.</p>
		</section>
	`;
	const title = article.querySelector(".feed-pr-title");
	const titleLink = document.createElement("a");
	titleLink.dataset.hovercardType = "pull_request";
	titleLink.href = "/openclaw/openclaw/pull/121223";
	titleLink.textContent = TITLE;
	const issueLink = document.createElement("a");
	issueLink.href = "/openclaw/openclaw/pull/121223";
	const issueNumber = document.createElement("span");
	issueNumber.textContent = ISSUE_NUMBER;
	issueLink.append(issueNumber);
	title.append(titleLink, document.createTextNode(" "), issueLink);
	return {
		actionDialog: article.querySelector(".js-feed-item-disinterest-dialog"),
		article,
		attribution: article.querySelector("header h3"),
		body: article.querySelector("[aria-label^='pull request body preview ']"),
		bodyHeading: article.querySelector(".markdown-body h2"),
		bodyText: article.querySelector(".markdown-body p"),
		feed: createFeedRoot(document, article),
		feedHeading: article.querySelector("header"),
		inlineBody: article.querySelector(".inline-link-prose"),
		inlineLink: article.querySelector(".inline-link-prose a"),
		issueLink,
		issueNumber,
		relocatedDialog: article.querySelector(".relocated-feed-dialog"),
		status: article.querySelector("[aria-label^='pull request details ']"),
		title,
		titleLink,
	};
}

function createFeedRoot(document, article = null) {
	const feed = document.createElement("div");
	feed.className = "news";
	feed.innerHTML = '<turbo-frame id="conduit-feed-frame" class="js-for-you-feed-items"></turbo-frame>';
	if (article) {
		feed.querySelector("#conduit-feed-frame").append(article);
	}
	return feed;
}

function assertFeedChromeUntouched(harness, card) {
	for (const region of [card.feedHeading, card.status, card.relocatedDialog]) {
		assert.equal(region.matches("[data-bt-source]"), false);
		assert.equal(Boolean(region.querySelector("[data-bt-source]")), false);
		assert.equal(Boolean(region.querySelector(".bt-translation")), false);
	}
	for (const text of FEED_CHROME_TEXT) {
		assert.equal(hasRequestedText(harness, text), false, `不应翻译 feed 元信息：${text}`);
	}
}

function assertTitlePlacement(harness, card, expectLinked) {
	const translation = harness.getTranslation(card.title);
	assert.ok(translation);
	assert.equal(translation.textContent, TITLE_TRANSLATION);
	assert.equal(translation.parentElement === card.titleLink, expectLinked);
	assert.equal(translation.closest("a[href]") === card.titleLink, expectLinked);
	assert.equal(Boolean(card.title.nextElementSibling?.matches(".bt-translation")), !expectLinked);
	assert.equal(card.titleLink.getAttribute("href"), "/openclaw/openclaw/pull/121223");
	assert.equal(card.issueNumber.textContent, ISSUE_NUMBER);
	assert.equal(card.issueNumber.parentElement === card.issueLink, true);
	assert.equal(card.issueLink.getAttribute("href"), "/openclaw/openclaw/pull/121223");
	if (!expectLinked) {
		return;
	}
	let clickCount = 0;
	card.titleLink.addEventListener("click", (event) => {
		event.preventDefault();
		clickCount += 1;
	});
	translation.dispatchEvent(new harness.window.MouseEvent("click", { bubbles: true }));
	assert.equal(clickCount, 1);
}

function hasRequestedText(harness, expected) {
	return allRequestedTexts(harness).some((text) => text.includes(expected));
}

function allRequestedTexts(harness) {
	return harness.translationRequests.flatMap(({ texts }) => texts);
}

function translateText(text) {
	return text.includes(TITLE) ? TITLE_TRANSLATION : `译文：${text}`;
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const contentStyles = readFileSync(
	new URL("../../chrome-extension/content/content.css", import.meta.url),
	"utf8",
);

// 验证 HN 标题译文先换行再保持行内，使来源站点紧跟在中文右侧。
test("Hacker News 标题译文允许来源站点同行延续", async () => {
	const sourceText = "Microsoft Word for Windows 1.1a, Native X64 Port";
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://news.ycombinator.com/";
		const story = createStory(harness.document, sourceText, "github.com/jmarshall23");
		harness.root.append(story.table);
		harness.start();
		await waitFor(
			() => Boolean(harness.getTranslation(story.storyLink)),
			"HN 标题译文没有生成",
		);

		const translation = harness.getTranslation(story.storyLink);
		assert.equal(harness.requestCount(sourceText), 1);
		assert.equal(translation.dataset.btLayout, "line-start-inline");
		assert.equal(translation.firstElementChild?.tagName, "BR");
		assert.equal(translation.childNodes.length, 2);
		assert.equal(translation.childNodes[1].nodeType, harness.window.Node.TEXT_NODE);
		assert.equal(translation.textContent, `译文：${sourceText}`);
		assert.equal(translation.previousElementSibling, story.storyLink);
		assert.equal(translation.nextElementSibling, story.siteBit);
		assert.equal(story.siteBit.textContent.trim(), "(github.com/jmarshall23)");
		assert.equal(harness.requestCount("github.com/jmarshall23"), 0);
		assert.equal(hasMetadataRequest(harness.translationRequests), false);
		assert.match(
			contentStyles,
			/\.bt-translation\[data-bt-owned="true"\]\[data-bt-layout="line-start-inline"\]\s*\{[^}]*display:\s*inline\s*!important/su,
		);

		const dynamicText = "A dynamically loaded Hacker News title remains correctly aligned";
		const dynamicStory = createStory(harness.document, dynamicText, "example.com");
		harness.root.append(dynamicStory.table);
		await waitFor(
			() => Boolean(harness.getTranslation(dynamicStory.storyLink)),
			"动态 HN 标题没有应用同行延续布局",
		);
		const dynamicTranslation = harness.getTranslation(dynamicStory.storyLink);
		assert.equal(dynamicTranslation.dataset.btLayout, "line-start-inline");
		assert.equal(dynamicTranslation.nextElementSibling, dynamicStory.siteBit);
		assert.equal(harness.requestCount(dynamicText), 1);

		harness.injectAgain();
		await waitFor(
			() => harness.messages.some(({ type }) => type === "CANCEL_RUN"),
			"停止运行没有清理 HN 专属译文布局",
		);
		assert.equal(harness.getTranslation(story.storyLink), null);
		assert.equal(story.storyLink.nextElementSibling, story.siteBit);
	} finally {
		harness.dispose();
	}
});

// 验证 HN 元信息按站点语义分类，并且关闭过滤时仍遵守用户设置。
test("Hacker News 元信息过滤保持主机与设置边界", async () => {
	const sourceText = "A Hacker News story title must remain translatable";
	for (const [url, skipSocialMetadata, expectHackerNewsLayout, expectMetadata] of [
		["https://news.ycombinator.com/", true, true, false],
		["https://news.ycombinator.com/", false, true, true],
		["https://example.com/", true, false, true],
	]) {
		const harness = createContentHarness({
			contentFilters: { skipSocialMetadata },
		});
		try {
			harness.window.location.href = url;
			const story = createStory(harness.document, sourceText, "boundary.example");
			harness.root.append(story.table);
			harness.start();
			await waitFor(
				() => Boolean(harness.getTranslation(story.storyLink)),
				`${url} 的 HN fixture 标题没有翻译`,
			);
			const translation = harness.getTranslation(story.storyLink);
			assert.equal(
				translation.dataset.btLayout === "line-start-inline",
				expectHackerNewsLayout,
			);
			assert.equal(hasMetadataRequest(harness.translationRequests), expectMetadata);
		} finally {
			harness.dispose();
		}
	}
});

function createStory(document, sourceText, siteName) {
	const table = document.createElement("table");
	table.innerHTML = `
		<tbody>
			<tr class="athing submission">
				<td class="title">
					<span class="titleline" style="display:inline">
						<a href="https://${siteName}" style="display:inline"></a>
						<span class="sitebit comhead" style="display:inline">
							(<a href="from?site=${siteName}" style="display:inline"><span>${siteName}</span></a>)
						</span>
					</span>
				</td>
			</tr>
			<tr>
				<td class="subtext" style="display:table-cell">
					<span class="score" style="display:inline">35 points</span> by
					<a href="user?id=author" style="display:inline">author</a>
					<span class="age" style="display:inline">2 hours ago</span> |
					<a href="hide?id=1" style="display:inline">hide</a> |
					<a href="item?id=1" style="display:inline">11 comments</a>
				</td>
			</tr>
		</tbody>
	`;
	const storyLink = table.querySelector(".athing .titleline > a");
	storyLink.textContent = sourceText;
	return {
		siteBit: table.querySelector(".sitebit"),
		storyLink,
		table,
	};
}

function hasMetadataRequest(requests) {
	return requests
		.flatMap(({ texts }) => texts)
		.some((text) => /35 points|author|2 hours ago|11 comments|boundary\.example/u.test(text));
}

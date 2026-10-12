import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import {
	createSiteProfile,
	findSiteProfileMutationRoot,
	SITE_PRESENTATION,
} from "../../src/content/site-profile.js";

// 验证 X 生成呈现只作用于明确枚举的应用主机，不扩散到帮助站或相似域名。
test("X 站点策略使用精确应用主机边界", () => {
	for (const hostname of [
		"x.com",
		"www.x.com",
		"mobile.x.com",
		"pro.x.com",
		"twitter.com",
		"www.twitter.com",
		"mobile.twitter.com",
	]) {
		assert.equal(
			createSiteProfile({ hostname }).getPresentation(),
			SITE_PRESENTATION.generated,
		);
	}
	for (const hostname of [
		"help.x.com",
		"developer.x.com",
		"business.x.com",
		"x.com.evil.test",
		"evilx.com",
		"example.com",
	]) {
		assert.equal(createSiteProfile({ hostname }).getPresentation(), null);
	}
});

// 验证 HN 标题与元信息规则只识别真实结构，不依赖全局类名或文本匹配。
test("Hacker News 站点策略识别标题呈现和元信息容器", () => {
	const window = new Window();
	try {
		const { document } = window;
		const table = document.createElement("table");
		table.innerHTML = `
			<tbody>
				<tr class="athing"><td class="title"><span class="titleline"><a>Story</a><span class="sitebit">(site)</span></span></td></tr>
				<tr><td class="subtext">35 points by author</td></tr>
			</tbody>
		`;
		const storyLink = table.querySelector(".titleline > a");
		const siteBit = table.querySelector(".sitebit");
		const subtext = table.querySelector(".subtext");
		const hackerNews = createSiteProfile({ hostname: "news.ycombinator.com" });
		assert.equal(
			hackerNews.getPresentation(storyLink),
			SITE_PRESENTATION.lineStartInline,
		);
		assert.equal(hackerNews.isMetadata(siteBit), true);
		assert.equal(hackerNews.isMetadata(subtext), true);

		const otherSite = createSiteProfile({ hostname: "example.com" });
		assert.equal(otherSite.getPresentation(storyLink), null);
		assert.equal(otherSite.isMetadata(siteBit), false);
		assert.equal(otherSite.isMetadata(subtext), false);
		for (const hostname of [
			"www.news.ycombinator.com",
			"news.ycombinator.com.evil.example",
		]) {
			const similarSite = createSiteProfile({ hostname });
			assert.equal(similarSite.getPresentation(storyLink), null);
			assert.equal(similarSite.isMetadata(subtext), false);
		}
	} finally {
		window.close();
	}
});

// 验证 GitHub 只排除贡献图的固定布局区域，不吞掉同一年度区内的正文。
test("GitHub 站点策略隔离 contribution calendar 与活动正文", () => {
	const window = new Window();
	try {
		const { document } = window;
		document.body.innerHTML = `
			<div class="js-yearly-contributions">
				<div class="position-relative">
					<h2>626 contributions in the last year</h2>
					<a>Skip to contributions year list</a>
					<div class="graph-before-activity-overview">
						<div class="js-calendar-graph ContributionCalendar">
							<table class="ContributionCalendar-grid"><tbody><tr><td class="ContributionCalendar-label">Aug</td></tr></tbody></table>
						</div>
					</div>
				</div>
				<div id="user-activity-overview"><p>Activity overview remains translatable.</p></div>
			</div>
		`;
		const graphRegion = document.querySelector(".graph-before-activity-overview");
		const graphLabel = document.querySelector(".ContributionCalendar-label");
		const yearlyHeading = document.querySelector("h2");
		const activityText = document.querySelector("#user-activity-overview p");
		const github = createSiteProfile({ hostname: "github.com" });

		assert.equal(github.isExcluded(graphRegion), true);
		assert.equal(github.isExcluded(graphLabel), true);
		assert.equal(github.isExcluded(yearlyHeading), false);
		assert.equal(github.isExcluded(activityText), false);

		for (const hostname of ["www.github.com", "gist.github.com", "github.com.evil.test"]) {
			const otherSite = createSiteProfile({ hostname });
			assert.equal(otherSite.isExcluded(graphLabel), false);
		}
	} finally {
		window.close();
	}
});

// 验证提交卡片按组件前缀隔离元信息与控件，不依赖哈希后缀或误伤标题和普通列表。
test("GitHub 站点策略隔离 commit row 元信息与阅读内容", () => {
	const window = new Window();
	try {
		const { document } = window;
		document.body.innerHTML = `
			<ul>
				<li data-testid="commit-row-item">
					<div data-listview-item-title-container="true"><h4><a>Commit title</a></h4></div>
					<div class="Description-module__container__changed">
						<div class="CommitAttribution-module__CommitAttributionContainer__changed"><a>Author</a><relative-time>last week</relative-time></div>
						<p>Commit description stays readable.</p>
					</div>
					<div class="MetadataContainer-module__container__changed"><a>f61db25</a><button>Copy commit hash</button></div>
					<button data-testid="commit-row-show-description-button"><span>Show description</span></button>
				</li>
				<li><div class="CommitAttribution-module__CommitAttributionContainer__changed">A regular attribution note.</div></li>
			</ul>
		`;
		const row = document.querySelector("[data-testid='commit-row-item']");
		const github = createSiteProfile({ hostname: "github.com" });
		const chromeRoots = row.querySelectorAll([
			"[class*='CommitAttribution-module__']",
			"[class*='MetadataContainer-module__']",
			"[data-testid='commit-row-show-description-button']",
		].join(", "));
		const chromeElements = [...chromeRoots].flatMap((region) => [region, ...region.querySelectorAll("*")]);
		for (const element of chromeElements) {
			assert.equal(github.isExcluded(element), true, "提交卡片的元信息应排除翻译");
			for (const hostname of ["example.com", "gist.github.com", "github.com.evil.test"]) {
				assert.equal(createSiteProfile({ hostname }).isExcluded(element), false);
			}
		}
		for (const selector of ["h4", "h4 a", "p", "[class*='Description-module__']", "li:last-child div"]) {
			assert.equal(github.isExcluded(document.querySelector(selector)), false,
				"标题、说明与普通列表不能因提交规则被排除");
		}
	} finally {
		window.close();
	}
});

// 验证 href hydration 只能在精确 GitHub 主机上触发站点重扫。
test("GitHub href mutation 使用精确主机边界", () => {
	const window = new Window();
	try {
		const { document } = window;
		document.body.innerHTML = `
			<article class="js-feed-item-component">
				<h3><a data-hovercard-type="pull_request" href="/owner/repo/pull/42">Title</a></h3>
			</article>
		`;
		const primary = document.querySelector("a");
		const mutation = createHrefMutation(primary);
		assert.equal(
			findSiteProfileMutationRoot(mutation, { hostname: "github.com" }),
			primary.closest("h3"),
		);
		for (const hostname of [
			"www.github.com",
			"gist.github.com",
			"github.com.evil.test",
			"example.com",
		]) {
			assert.equal(findSiteProfileMutationRoot(mutation, { hostname }), null);
		}
	} finally {
		window.close();
	}
});

// 验证 PR 主链接与其 issue 副链接只使标题 h3 失效，不扩大到卡片或普通链接。
test("GitHub href mutation 返回最窄 PR 标题边界", () => {
	const window = new Window();
	try {
		const { document } = window;
		document.body.innerHTML = `
			<a id="outside" href="/outside">Outside</a>
			<article class="js-feed-item-component">
				<header><h3><a id="repository" href="/owner/repo">owner/repo</a></h3></header>
				<h3 id="title">
					<a id="primary" data-hovercard-type="pull_request" href="/owner/repo/pull/42">Title</a>
					<a id="issue" href="/owner/repo/pull/42"><span>#42</span></a>
				</h3>
				<p><a id="body" data-hovercard-type="pull_request" href="/owner/repo/pull/43">Body</a></p>
				<h3 id="orphan-heading"><a id="orphan" href="/owner/repo/issues/44">#44</a></h3>
			</article>
			<article><h3><a id="other-article" data-hovercard-type="pull_request" href="/pull/45">Other</a></h3></article>
		`;
		const title = document.querySelector("#title");
		const primary = document.querySelector("#primary");
		const issue = document.querySelector("#issue");
		const github = { hostname: "github.com" };

		assert.equal(findSiteProfileMutationRoot(createHrefMutation(primary), github), title);
		primary.setAttribute("href", "/owner/repo/pull/420");
		assert.equal(findSiteProfileMutationRoot(createHrefMutation(primary), github), title);
		assert.equal(findSiteProfileMutationRoot(createHrefMutation(issue), github), title);
		issue.removeAttribute("href");
		assert.equal(findSiteProfileMutationRoot(createHrefMutation(issue), github), title);

		for (const selector of ["#outside", "#repository", "#body", "#orphan", "#other-article"]) {
			const link = document.querySelector(selector);
			assert.equal(findSiteProfileMutationRoot(createHrefMutation(link), github), null);
		}

		primary.removeAttribute("href");
		assert.equal(findSiteProfileMutationRoot(createHrefMutation(primary), github), title);
		assert.equal(findSiteProfileMutationRoot(createHrefMutation(issue), github), null);
	} finally {
		window.close();
	}
});

function createHrefMutation(target) {
	return { attributeName: "href", target, type: "attributes" };
}

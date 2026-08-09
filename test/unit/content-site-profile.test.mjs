import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import {
	createSiteProfile,
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

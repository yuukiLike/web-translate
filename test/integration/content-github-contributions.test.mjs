import assert from "node:assert/strict";
import test from "node:test";

import {
	createContentHarness,
	waitFor,
} from "../helpers/content-dom-harness.mjs";

const CALENDAR_TEXT = [
	"Contribution Graph",
	"August",
	"Monday",
	"No contributions on August 10th.",
	"Learn how we count contributions",
	"Less",
	"More",
];

// Fixture 取自 GitHub 个人主页异步 contributions fragment 的最小稳定结构。
test("GitHub contribution calendar 不翻译且不影响图外正文", async () => {
	const harness = createContentHarness({
		contentFilters: {
			skipShortLinks: false,
			skipSocialMetadata: false,
			skipTechnicalIdentifiers: false,
		},
	});
	try {
		harness.window.location.href = "https://github.com/yuukiLike";
		const section = createContributionSection(harness.document);
		harness.root.append(section.yearlyContributions);
		harness.start();

		await waitFor(
			() => Boolean(harness.getTranslation(section.activityText)),
			"GitHub contribution calendar 外的活动正文没有翻译",
		);

		assertCalendarUntouched(harness, section.graphRegion);
		assert.equal(harness.requestCount(section.heading.textContent), 1);
		assert.equal(harness.requestCount(section.activityText.textContent), 1);

		const dynamicCalendar = createCalendar(harness.document, {
			month: "September",
			monthShort: "Sep",
		});
		const dynamicActivityText = harness.document.createElement("p");
		dynamicActivityText.textContent =
			"Dynamically loaded contribution activity remains translatable.";
		section.graphRegion.replaceWith(dynamicCalendar.boundary);
		section.activityOverview.append(dynamicActivityText);

		await waitFor(
			() => Boolean(harness.getTranslation(dynamicActivityText)),
			"动态 GitHub contribution calendar 外的正文没有翻译",
		);
		assertCalendarUntouched(harness, dynamicCalendar.boundary);
		assert.equal(
			allRequestedTexts(harness).some((text) => text.includes("September")),
			false,
		);
	} finally {
		harness.dispose();
	}
});

// 站点组件选择器不能退化成全局表格或类名规则。
test("GitHub contribution calendar 规则使用精确主机名边界", async () => {
	for (const url of ["https://example.com/", "https://github.com.evil.test/"]) {
		const harness = createContentHarness();
		try {
			harness.window.location.href = url;
			const { graphRegion, yearlyContributions } =
				createContributionSection(harness.document);
			harness.root.append(yearlyContributions);
			harness.start();

			await waitFor(
				() => allRequestedTexts(harness).some((text) => text === "Contribution Graph"),
				`${url} 的普通表格内容被 GitHub 规则误伤`,
			);
			assert.ok(graphRegion.querySelector("[data-bt-source]"));
		} finally {
			harness.dispose();
		}
	}
});

// 已经排队的普通正文若在响应返回前移入图表，渲染前复核也必须拒绝注入。
test("GitHub contribution calendar 在渲染前重新应用排除边界", async () => {
	const deferred = Promise.withResolvers();
	const sourceText = "A pending contribution note must not render inside the graph.";
	const harness = createContentHarness({
		translateText: async (text) => {
			if (text === sourceText) {
				return deferred.promise;
			}
			return `译文：${text}`;
		},
	});
	try {
		harness.window.location.href = "https://github.com/yuukiLike";
		// 关闭增量观察，确保该用例只验证 Renderer 的最终候选复核。
		harness.window.MutationObserver = class {
			observe() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		};
		const { boundary, calendar } = createCalendar(harness.document);
		const yearlyContributions = harness.document.createElement("div");
		yearlyContributions.className = "js-yearly-contributions";
		yearlyContributions.append(boundary);
		const source = harness.document.createElement("p");
		source.textContent = sourceText;
		harness.root.append(yearlyContributions, source);
		harness.start();

		await waitFor(
			() => harness.requestCount(sourceText) === 1,
			"图表外正文没有进入待返回请求",
		);
		calendar.append(source);
		deferred.resolve(`译文：${sourceText}`);

		await waitFor(
			() => source.dataset.btSource === undefined,
			"移入 GitHub contribution calendar 的待渲染正文没有失效",
		);
		assert.equal(harness.getTranslation(source), null);
		assert.equal(source.closest(".graph-before-activity-overview"), boundary);
	} finally {
		harness.dispose();
	}
});

function createContributionSection(document) {
	const yearlyContributions = document.createElement("div");
	yearlyContributions.className = "js-yearly-contributions";

	const heading = document.createElement("h2");
	heading.id = "js-contribution-activity-description";
	heading.textContent = "626 contributions in the last year";
	const { boundary } = createCalendar(document);
	const graphContainer = document.createElement("div");
	graphContainer.className = "position-relative";
	const skipLink = document.createElement("a");
	skipLink.textContent = "Skip to contributions year list";
	graphContainer.append(heading, skipLink, boundary);

	const activityOverview = document.createElement("div");
	activityOverview.id = "user-activity-overview";
	const activityHeading = document.createElement("h3");
	activityHeading.textContent = "Activity overview";
	const activityText = document.createElement("p");
	activityText.textContent =
		"Contributed to several repositories and reviewed recent pull requests.";
	activityOverview.append(activityHeading, activityText);
	yearlyContributions.append(graphContainer, activityOverview);

	return {
		activityOverview,
		activityText,
		graphRegion: boundary,
		heading,
		yearlyContributions,
	};
}

function createCalendar(document, { month = "August", monthShort = "Aug" } = {}) {
	const boundary = document.createElement("div");
	boundary.className = "py-2 graph-before-activity-overview";
	boundary.innerHTML = `
		<div class="js-calendar-graph graph-canvas ContributionCalendar" data-graph-url="/users/yuukiLike/contributions">
			<table role="grid" aria-readonly="true" class="ContributionCalendar-grid js-calendar-graph-table">
				<caption class="sr-only">Contribution Graph</caption>
				<thead><tr>
					<td class="ContributionCalendar-label"><span>${month}</span><span aria-hidden="true">${monthShort}</span></td>
				</tr></thead>
				<tbody><tr>
					<td class="ContributionCalendar-label"><span>Monday</span><span aria-hidden="true">Mon</span></td>
					<td role="gridcell" class="ContributionCalendar-day"></td>
					<tool-tip class="sr-only position-absolute">No contributions on August 10th.</tool-tip>
				</tr></tbody>
			</table>
			<div><a>Learn how we count contributions</a><span>Less</span><span>More</span></div>
		</div>
	`;
	return {
		boundary,
		calendar: boundary.querySelector(".js-calendar-graph"),
	};
}

function assertCalendarUntouched(harness, calendar) {
	assert.ok(
		calendar.querySelector(
			".js-calendar-graph.ContributionCalendar > table.ContributionCalendar-grid",
		),
	);
	assert.equal(calendar.querySelector("[data-bt-source]"), null);
	assert.equal(calendar.querySelector(".bt-translation"), null);
	const requestedTexts = allRequestedTexts(harness);
	for (const text of CALENDAR_TEXT) {
		assert.equal(
			requestedTexts.some((requested) => requested.includes(text)),
			false,
			`贡献图文本不应提交翻译：${text}`,
		);
	}
}

function allRequestedTexts(harness) {
	return harness.translationRequests.flatMap(({ texts }) => texts);
}

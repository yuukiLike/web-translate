import { SELECTORS } from "./constants.js";

export const SITE_PRESENTATION = Object.freeze({
	generated: "generated",
	lineStartInline: "line-start-inline",
});

const EMPTY_PROFILE = Object.freeze({
	findContentUnit: () => null,
	getPresentation: () => null,
	isExcluded: () => false,
	isMetadata: () => false,
});

const HACKER_NEWS_METADATA = [
	".rank",
	".votelinks",
	".sitebit",
	".subtext",
].join(", ");

const HACKER_NEWS_PAGE_CHROME = [
	".pagetop",
	".morelink",
	".yclinks",
].join(", ");

const HACKER_NEWS_PROFILE = Object.freeze({
	findContentUnit: () => null,
	getPresentation(element) {
		return isHackerNewsStoryLink(element)
			? SITE_PRESENTATION.lineStartInline
			: null;
	},
	isExcluded(element) {
		return Boolean(element.closest(HACKER_NEWS_PAGE_CHROME));
	},
	isMetadata(element) {
		return Boolean(element.closest(HACKER_NEWS_METADATA));
	},
});

const X_APP_HOSTNAMES = new Set([
	"x.com",
	"www.x.com",
	"mobile.x.com",
	"pro.x.com",
	"twitter.com",
	"www.twitter.com",
	"mobile.twitter.com",
]);

const X_PAGE_CHROME = [
	"nav",
	"[role='navigation']",
	"[role='tablist']",
	"[role='menu']",
	"[role='tooltip']",
	"[data-testid='User-Name']",
	"[data-testid='tweet'] [role='group']",
	"[data-testid='tweet-text-show-more-link']",
].join(", ");

const X_PROFILE = Object.freeze({
	findContentUnit(element) {
		return element.closest(SELECTORS.atomic);
	},
	getPresentation() {
		return SITE_PRESENTATION.generated;
	},
	isExcluded(element) {
		return Boolean(element.closest(X_PAGE_CHROME)) || isXControlLabel(element);
	},
	isMetadata: () => false,
});

/** 按精确主机名返回窄站点规则，未匹配时完整保留通用扫描行为。 */
export function createSiteProfile(locationRef = globalThis.location) {
	const hostname = locationRef?.hostname ?? "";
	if (hostname === "news.ycombinator.com") {
		return HACKER_NEWS_PROFILE;
	}
	if (X_APP_HOSTNAMES.has(hostname)) {
		return X_PROFILE;
	}
	return EMPTY_PROFILE;
}

function isHackerNewsStoryLink(element) {
	if (!element.matches("a")) {
		return false;
	}
	const titleLine = element.parentElement;
	return Boolean(
		titleLine?.matches(".athing td.title > .titleline") &&
			titleLine.querySelector(":scope > a") === element,
	);
}

function isXControlLabel(element) {
	const control = element.closest("button, [role='button']");
	if (!control?.closest(SELECTORS.atomic)) {
		return false;
	}
	const richContent = element.closest(`${SELECTORS.leaf}, ${SELECTORS.atomic}`);
	return !richContent || !control.contains(richContent);
}

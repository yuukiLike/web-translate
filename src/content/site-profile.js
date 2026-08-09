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

const GITHUB_YEARLY_CONTRIBUTIONS = ".js-yearly-contributions";
const GITHUB_CONTRIBUTION_GRAPH_REGION = ".graph-before-activity-overview";
const GITHUB_FEED_ITEM = "article.js-feed-item-component";
const GITHUB_FEED_CHROME = [
	`${GITHUB_FEED_ITEM} > header`,
	`${GITHUB_FEED_ITEM} [aria-label^='pull request details ']`,
	`${GITHUB_FEED_ITEM} .js-feed-item-disinterest-dialog`,
].join(", ");
const GITHUB_FEED_BOUNDARY_CLASSES = new Set([
	"feed-item-heading-menu-button",
	"js-feed-item-component",
	"js-feed-item-disinterest-dialog",
]);

const GITHUB_PROFILE = Object.freeze({
	findContentUnit: () => null,
	getPresentation: () => null,
	isExcluded(element) {
		return isGitHubContributionGraph(element) || isGitHubFeedChrome(element);
	},
	isMetadata: () => false,
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
	if (hostname === "github.com") {
		return GITHUB_PROFILE;
	}
	if (X_APP_HOSTNAMES.has(hostname)) {
		return X_PROFILE;
	}
	return EMPTY_PROFILE;
}

/** 仅当站点 DOM 明确把整段译文归属于一个主链接时返回该链接。 */
export function findSiteTranslationLinkAnchor(element, locationRef = globalThis.location) {
	if (locationRef?.hostname !== "github.com") {
		return null;
	}
	return findGitHubPullRequestTitleLink(element);
}

/** 返回会因属性 hydration 改变 GitHub 排除或链接边界的最小重扫根。 */
export function findSiteProfileMutationRoot(mutation, locationRef = globalThis.location) {
	if (mutation.type === "attributes" && mutation.attributeName === "href") {
		return mutation.target;
	}
	if (locationRef?.hostname !== "github.com") {
		return null;
	}
	if (mutation.type === "childList") {
		return findGitHubActionDetailsMutationRoot(mutation);
	}
	if (mutation.type !== "attributes") {
		return null;
	}
	const element = mutation.target;
	if (mutation.attributeName === "class") {
		if (didBoundaryClassChange(element, mutation.oldValue)) {
			return element.closest("details") ?? element;
		}
		return null;
	}
	if (mutation.attributeName === "aria-label") {
		const prefix = "pull request details ";
		const wasDetails = String(mutation.oldValue ?? "").startsWith(prefix);
		const isDetails = String(element.getAttribute("aria-label") ?? "").startsWith(prefix);
		return (wasDetails || isDetails) && element.closest(GITHUB_FEED_ITEM)
			? element
			: null;
	}
	if (mutation.attributeName === "data-hovercard-type") {
		return element.closest(`${GITHUB_FEED_ITEM} h3`);
	}
	return null;
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

function isGitHubContributionGraph(element) {
	const graphRegion = element.closest(GITHUB_CONTRIBUTION_GRAPH_REGION);
	return Boolean(graphRegion?.closest(GITHUB_YEARLY_CONTRIBUTIONS));
}

function isGitHubFeedChrome(element) {
	return Boolean(
		element.closest(GITHUB_FEED_CHROME) || findGitHubFeedActionDetails(element),
	);
}

function findGitHubFeedActionDetails(element) {
	const details = element.closest(`${GITHUB_FEED_ITEM} details`);
	if (!details) {
		return null;
	}
	const ownsDialog = [...details.children].some((child) =>
		child.matches(".js-feed-item-disinterest-dialog"),
	);
	const summary = [...details.children].find((child) => child.matches("summary"));
	const ownsMenuButton = Boolean(
		summary?.matches(".feed-item-heading-menu-button") ||
			summary?.querySelector(".feed-item-heading-menu-button"),
	);
	return ownsDialog || ownsMenuButton ? details : null;
}

function findGitHubActionDetailsMutationRoot(mutation) {
	const details = mutation.target.closest?.(`${GITHUB_FEED_ITEM} details`);
	if (!details) {
		return null;
	}
	const boundary = ".js-feed-item-disinterest-dialog, .feed-item-heading-menu-button";
	const boundaryChanged = [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
		node.matches?.(boundary) || node.querySelector?.(boundary),
	);
	return boundaryChanged ? details : null;
}

function findGitHubPullRequestTitleLink(element) {
	if (!element.matches("h3") || !element.closest(GITHUB_FEED_ITEM)) {
		return null;
	}
	const primary = element.querySelector("a[data-hovercard-type='pull_request'][href]");
	if (!primary) {
		return null;
	}
	let hasPrimaryText = false;
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!/[\p{L}\p{N}]/u.test(node.textContent ?? "")) {
			continue;
		}
		const anchor = node.parentElement?.closest("a[href]");
		if (anchor === primary) {
			hasPrimaryText = true;
			continue;
		}
		if (
			!anchor ||
			!element.contains(anchor) ||
			anchor.href !== primary.href ||
			!/^#\d+$/u.test(anchor.textContent.trim())
		) {
			return null;
		}
	}
	return hasPrimaryText ? primary : null;
}

function didBoundaryClassChange(element, oldClassName) {
	const before = new Set(String(oldClassName ?? "").split(/\s+/u).filter(Boolean));
	const after = new Set(String(element.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean));
	return [...GITHUB_FEED_BOUNDARY_CLASSES].some(
		(className) => before.has(className) !== after.has(className),
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

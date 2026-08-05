export const CONTROLLER_KEY = "__bilingualWebTranslatorController";

export const TIMING = Object.freeze({
	mutationDebounce: 180,
	visibilityDebounce: 250,
	completionSettle: 300,
	completionToast: 2_800,
});

export const RUN_TRANSLATION_CACHE_LIMIT = 750;
export const SOURCE_PART_CHARACTER_LIMIT = 3_500;
export const PRIORITY = Object.freeze({
	belowFold: 1_000_000,
	aboveViewport: 2_000_000,
});
export const VISIBLE_BATCH_LIMIT = Object.freeze({
	characters: 3_000,
	items: 15,
});

export const SELECTORS = Object.freeze({
	atomic: "[data-testid='tweetText']",
	structural: "li, blockquote, figcaption, caption, td, th, dt, dd, summary",
	leaf: "p, h1, h2, h3, h4, h5, h6",
	language: "[lang]:not(html):not(body)",
	interactive: "a, button, input, textarea, select, option, [role='button'], [role='link']",
	root: "main, article, [role='main']",
	excluded: [
		"script",
		"style",
		"noscript",
		"template",
		"svg",
		"canvas",
		"code",
		"pre",
		"kbd",
		"samp",
		"input",
		"textarea",
		"select",
		"option",
		"[contenteditable='true']",
		"[translate='no']",
		".bt-translation",
		".bt-status",
	].join(","),
});

export const OWNED_NODE_SELECTOR = "[data-bt-owned='true']";
export const TRANSLATION_NODE_SELECTOR = ".bt-translation[data-bt-owned='true']";

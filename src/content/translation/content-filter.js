const SHORT_INTERACTIVE_FRAGMENT_LIMIT = 3;

const SOCIAL_HANDLE_SOURCE = String.raw`@[A-Za-z0-9_]{1,64}(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?`;
const SOCIAL_HANDLE_PATTERN = new RegExp(`^${SOCIAL_HANDLE_SOURCE}$`, "u");
const HANDLE_WITH_TIME_PATTERN = new RegExp(
	`^${SOCIAL_HANDLE_SOURCE}(?:\\s*[·•|｜—–-]\\s*|\\s+)(.+)$`,
	"u",
);
const COMPACT_RELATIVE_TIME_PATTERN = /^\d+(?:[.,]\d+)?\s*(?:h|d|w|mo|y)$/u;
const AMBIGUOUS_COMPACT_TIME_PATTERN = /^\d+(?:[.,]\d+)?\s*(?:s|m)$/u;
const ENGLISH_RELATIVE_TIME_PATTERN =
	/^\d+(?:[.,]\d+)?\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)(?:\s+ago)?$/iu;
const CJK_RELATIVE_TIME_PATTERN = /^\d+(?:[.,]\d+)?\s*(?:秒|分钟|小时|天|周|个月|年)前$/u;

/** 根据用户的内容过滤设置，判断整个候选块是否应该跳过。 */
export function shouldSkipCandidate(candidate, contentFilters = {}) {
	const text = String(candidate?.text ?? "").trim();
	if (!text) {
		return false;
	}
	if (
		isFilterEnabled(contentFilters, "skipTechnicalIdentifiers") &&
		isTechnicalIdentifier(text)
	) {
		return true;
	}
	if (
		isFilterEnabled(contentFilters, "skipSocialMetadata") &&
		isSocialMetadata(text, candidate?.traits?.metadataOnly)
	) {
		return true;
	}

	const interactiveKind = candidate?.traits?.interactiveKind;
	if (interactiveKind === "link" && !isFilterEnabled(contentFilters, "skipShortLinks")) {
		return false;
	}
	if (interactiveKind === "button" && !isFilterEnabled(contentFilters, "skipShortButtons")) {
		return false;
	}
	if (interactiveKind !== "link" && interactiveKind !== "button") {
		return false;
	}
	return isShortEnglishLabel(text);
}

function isFilterEnabled(contentFilters, key) {
	return contentFilters?.[key] !== false;
}

function isTechnicalIdentifier(text) {
	return (
		/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/u.test(text) ||
		/^v?\d+\.\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/u.test(text) ||
		/^(?=[a-f\d]{7,40}$)(?=.*[a-f])[a-f\d]+$/iu.test(text) ||
		/^\.[A-Za-z][\w-]*$/u.test(text) ||
		/^(?:\.?[A-Za-z_][\w@-]*\.)[A-Za-z\d]{1,12}$/u.test(text) ||
		/^[A-Za-z_$][A-Za-z\d$]*(?:_[A-Za-z\d$]+)+$/u.test(text) ||
		isPathLikeIdentifier(text)
	);
}

function isPathLikeIdentifier(text) {
	if (!/^(?:[.~@]?[\w-]+)?(?:[/\\][\w.@-]+)+$/u.test(text)) {
		return false;
	}
	return (
		/^(?:\.{0,2}[/\\]|[/\\]|~[/\\]|@)/u.test(text) ||
		/[._-]/u.test(text) ||
		/[a-z][A-Z]/u.test(text)
	);
}

function isSocialMetadata(text, metadataOnly = false) {
	if (metadataOnly || SOCIAL_HANDLE_PATTERN.test(text) || isRelativeTime(text)) {
		return true;
	}
	const handleWithTime = HANDLE_WITH_TIME_PATTERN.exec(text);
	return Boolean(handleWithTime && isRelativeTime(handleWithTime[1], true));
}

function isRelativeTime(text, allowAmbiguousUnits = false) {
	return (
		COMPACT_RELATIVE_TIME_PATTERN.test(text) ||
		ENGLISH_RELATIVE_TIME_PATTERN.test(text) ||
		CJK_RELATIVE_TIME_PATTERN.test(text) ||
		(allowAmbiguousUnits && AMBIGUOUS_COMPACT_TIME_PATTERN.test(text))
	);
}

function isShortEnglishLabel(text) {
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length === 0 || letters.some((letter) => !/[A-Za-z]/u.test(letter))) {
		return false;
	}
	const visibleFragments = text
		.split(/\s+/u)
		.filter((fragment) => /[A-Za-z\d]/u.test(fragment));
	return (
		visibleFragments.length > 0 &&
		visibleFragments.length <= SHORT_INTERACTIVE_FRAGMENT_LIMIT
	);
}

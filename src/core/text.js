import { SOURCE_MODES, TARGET_MODES } from "./constants.js";
import { clampInteger, safeString } from "./value-utils.js";
import { preserveInlineLinkMarkerBoundary } from "./inline-link-markers.js";

export function normalizeSourceText(value) {
	return String(value)
		.replace(/\r\n?/g, "\n")
		.replace(/\u00a0/g, " ")
		.replace(/[^\S\n]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function normalizeText(value) {
	return normalizeSourceText(value).replace(/\s+/g, " ").trim();
}

function normalizeLanguageTag(value) {
	const language = safeString(value).toLowerCase();
	if (language === "zh" || language.startsWith("zh-")) {
		return "zh";
	}
	if (language === "en" || language.startsWith("en-")) {
		return "en";
	}
	return "auto";
}

function cjkRatio(value) {
	const text = normalizeText(value);
	if (!text) {
		return 0;
	}
	const cjkCharacters = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
	const meaningfulCharacters = text.match(/[\p{L}\p{N}]/gu)?.length ?? text.length;
	return meaningfulCharacters === 0 ? 0 : cjkCharacters / meaningfulCharacters;
}

export function getLanguagePair(
	documentLanguage,
	sampleText,
	sourceMode = "auto",
	targetMode = "zh",
) {
	const normalizedSourceMode = SOURCE_MODES.has(sourceMode) ? sourceMode : "auto";
	const normalizedTargetMode = TARGET_MODES.has(targetMode) ? targetMode : "zh";
	if (normalizedSourceMode !== "auto") {
		return {
			sourceLanguage: normalizedSourceMode,
			targetLanguage: normalizedSourceMode === "zh" ? "en" : "zh",
		};
	}
	const declaredLanguage = normalizeLanguageTag(documentLanguage);
	const ratio = cjkRatio(sampleText);
	const hasLatin = /[A-Za-z]/u.test(sampleText);
	// 页面和片段的 lang 经常继承错；可识别的正文优先于宿主声明。
	const sourceLanguage = ratio >= 0.35 ? "zh" : hasLatin ? "en" : declaredLanguage === "auto" ? "en" : declaredLanguage;
	return {
		sourceLanguage,
		targetLanguage: normalizedTargetMode,
	};
}

export function shouldTranslateText(value, targetLanguage) {
	const text = normalizeText(value);
	if (text.length < 2) {
		return false;
	}
	if (
		!/[\p{L}\p{N}]/u.test(text) ||
		/^(?:https?:\/\/|www\.)\S+$/iu.test(text) ||
		isNumericDisplayText(text)
	) {
		return false;
	}
	const ratio = cjkRatio(text);
	return targetLanguage === "zh" ? ratio < 0.35 : ratio >= 0.12;
}

function isNumericDisplayText(text) {
	const numericBody = text.replace(
		/(\p{N})(?:[KMBT]|万|亿)(?=$|[\s+%‰,)])/gu,
		"$1",
	);
	return /\p{N}/u.test(numericBody) && !/\p{L}/u.test(numericBody);
}

export function splitText(value, maximumCharacters = 3_500) {
	maximumCharacters = clampInteger(maximumCharacters, 3_500, 2, 30_000);
	const text = normalizeSourceText(value);
	if (!text) {
		return [];
	}
	if (text.length <= maximumCharacters) {
		return [text];
	}

	const parts = [];
	let remaining = text;
	while (remaining.length > maximumCharacters) {
		const window = remaining.slice(0, maximumCharacters + 1);
		const preferredSeparators = ["。", "！", "？", ".", "!", "?", "；", ";", "\n"];
		let cut = Math.max(...preferredSeparators.map((separator) => window.lastIndexOf(separator)));
		if (cut < maximumCharacters * 0.55) {
			cut = window.lastIndexOf(" ");
		}
		cut = cut < maximumCharacters * 0.4 ? maximumCharacters : cut + 1;
		cut = Math.min(cut, maximumCharacters);
		cut = preserveInlineLinkMarkerBoundary(remaining, cut);
		// UTF-16 分片不能把 emoji 或扩展汉字切成两个孤立代理项。
		if (/[\uD800-\uDBFF]/u.test(remaining[cut - 1]) && /[\uDC00-\uDFFF]/u.test(remaining[cut])) cut -= 1;
		parts.push(remaining.slice(0, cut).trim());
		remaining = remaining.slice(cut).trim();
	}
	if (remaining) {
		parts.push(remaining);
	}
	return parts.filter(Boolean);
}

export function batchSegments(segments, maximumCharacters, maximumItems) {
	const batches = [];
	let current = [];
	let characterCount = 0;
	for (const segment of segments) {
		const exceedsLimit =
			current.length > 0 &&
			(current.length >= maximumItems || characterCount + segment.text.length > maximumCharacters);
		if (exceedsLimit) {
			batches.push(current);
			current = [];
			characterCount = 0;
		}
		current.push(segment);
		characterCount += segment.text.length;
	}
	if (current.length > 0) {
		batches.push(current);
	}
	return batches;
}

export function hashText(value) {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		first ^= code;
		first = Math.imul(first, 0x01000193);
		second ^= code + ((second << 6) >>> 0) + (second >>> 2);
		second = Math.imul(second, 0x85ebca6b);
	}
	return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function getMaximumTranslationLength(sourceLength) {
	return Math.min(20_000, Math.max(2_000, clampInteger(sourceLength, 0, 0, 30_000) * 4));
}

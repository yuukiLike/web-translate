import { SOURCE_MODES, TARGET_MODES } from "./constants.js";
import { clampInteger, safeString } from "./value-utils.js";

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
	const sourceLanguage =
		declaredLanguage === "auto" ? (cjkRatio(sampleText) >= 0.12 ? "zh" : "en") : declaredLanguage;
	return {
		sourceLanguage,
		targetLanguage: normalizedTargetMode,
	};
}

export function shouldTranslateText(value, targetLanguage) {
	const text = normalizeText(value);
	if (text.length < 2 || text.length > 30_000) {
		return false;
	}
	if (!/[\p{L}\p{N}]/u.test(text) || /^(?:https?:\/\/|www\.)\S+$/iu.test(text)) {
		return false;
	}
	const ratio = cjkRatio(text);
	return targetLanguage === "zh" ? ratio < 0.35 : ratio >= 0.12;
}

export function splitText(value, maximumCharacters = 3_500) {
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

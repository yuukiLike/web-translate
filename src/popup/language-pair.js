import { SOURCE_MODES, TARGET_MODES } from "../core/constants.js";

export function parseLanguagePair(value) {
	const sourceMode = value?.sourceMode;
	const targetLanguage = value?.targetLanguage;
	if (
		!SOURCE_MODES.has(sourceMode) ||
		!TARGET_MODES.has(targetLanguage) ||
		(sourceMode !== "auto" && sourceMode === targetLanguage)
	) {
		throw new Error("Popup 语言配置无效");
	}
	return { sourceMode, targetLanguage };
}

export function changeSourceLanguage(currentPair, sourceMode) {
	const current = parseLanguagePair(currentPair);
	if (!SOURCE_MODES.has(sourceMode)) {
		throw new Error("输入语言无效");
	}
	const targetLanguage =
		sourceMode !== "auto" && sourceMode === current.targetLanguage
			? oppositeLanguage(sourceMode)
			: current.targetLanguage;
	return { sourceMode, targetLanguage };
}

export function changeTargetLanguage(currentPair, targetLanguage) {
	const current = parseLanguagePair(currentPair);
	if (!TARGET_MODES.has(targetLanguage)) {
		throw new Error("输出语言无效");
	}
	const sourceMode =
		current.sourceMode !== "auto" && current.sourceMode === targetLanguage
			? oppositeLanguage(targetLanguage)
			: current.sourceMode;
	return { sourceMode, targetLanguage };
}

function oppositeLanguage(language) {
	return language === "zh" ? "en" : "zh";
}

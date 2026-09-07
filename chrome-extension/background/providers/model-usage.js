import { numberOrUndefined } from "../utilities.js";

export function getResultUsage(result, apiCalls, sourceCharacters) {
	const inputTokens = numberOrUndefined(result.usage?.inputTokens);
	const outputTokens = numberOrUndefined(result.usage?.outputTokens);
	return {
		apiCalls,
		charactersSubmitted: sourceCharacters * apiCalls,
		inputTokens,
		cachedInputTokens: numberOrUndefined(result.usage?.cacheReadTokens),
		outputTokens,
		tokenUsageMissingCalls:
			Math.max(0, apiCalls - 1) +
			(inputTokens === undefined || outputTokens === undefined ? 1 : 0),
	};
}

export function getUnknownRequestUsage(apiCalls, sourceCharacters) {
	return {
		apiCalls,
		charactersSubmitted: sourceCharacters * apiCalls,
		inputTokens: undefined,
		cachedInputTokens: undefined,
		outputTokens: undefined,
		tokenUsageMissingCalls: apiCalls,
	};
}

export function addUsage(left, right) {
	return {
		apiCalls: left.apiCalls + right.apiCalls,
		charactersSubmitted: left.charactersSubmitted + right.charactersSubmitted,
		inputTokens: addOptionalNumbers(left.inputTokens, right.inputTokens),
		cachedInputTokens: addOptionalNumbers(left.cachedInputTokens, right.cachedInputTokens),
		outputTokens: addOptionalNumbers(left.outputTokens, right.outputTokens),
		tokenUsageMissingCalls: left.tokenUsageMissingCalls + right.tokenUsageMissingCalls,
	};
}

export function attachTranslationUsage(error, usage) {
	const target = error instanceof Error ? error : new Error("模型翻译失败");
	target.translationUsage = target.translationUsage
		? addUsage(usage, target.translationUsage)
		: usage;
	return target;
}

function addOptionalNumbers(left, right) {
	return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

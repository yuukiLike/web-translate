function normalizeTokenCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeTranslationResult(result) {
	const inputTokenDetails = result.usage.inputTokenDetails;
	return {
		text: result.text,
		finishReason: result.finishReason,
		rawFinishReason: result.rawFinishReason ?? null,
		responseId: result.response.id,
		responseModel: result.response.modelId,
		usage: {
			inputTokens: normalizeTokenCount(result.usage.inputTokens),
			outputTokens: normalizeTokenCount(result.usage.outputTokens),
			cacheReadTokens: normalizeTokenCount(inputTokenDetails.cacheReadTokens),
			cacheWriteTokens: normalizeTokenCount(inputTokenDetails.cacheWriteTokens),
			noCacheTokens: normalizeTokenCount(inputTokenDetails.noCacheTokens),
		},
		warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
	};
}

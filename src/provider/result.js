function normalizeOptionalTokenCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeRequiredTokenCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

export function normalizeTranslationResult(result) {
	const usage = result.usage ?? {};
	const inputTokenDetails = usage.inputTokenDetails ?? {};
	return {
		text: result.text,
		finishReason: result.finishReason,
		rawFinishReason: result.rawFinishReason ?? null,
		responseId: result.response.id,
		responseModel: result.response.modelId,
		usage: {
			inputTokens: normalizeRequiredTokenCount(usage.inputTokens),
			outputTokens: normalizeRequiredTokenCount(usage.outputTokens),
			cacheReadTokens: normalizeOptionalTokenCount(inputTokenDetails.cacheReadTokens),
			cacheWriteTokens: normalizeOptionalTokenCount(inputTokenDetails.cacheWriteTokens),
			noCacheTokens: normalizeOptionalTokenCount(inputTokenDetails.noCacheTokens),
		},
		warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
	};
}

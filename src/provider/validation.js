export function validateGenerationInput({ apiKey, instructions, messages, maxOutputTokens }, model) {
	if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4_096) {
		throw new Error("A valid API key is required");
	}
	if (typeof instructions !== "string" || !instructions.trim()) {
		throw new Error("Translation instructions are required");
	}
	if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== "user" ||
		typeof messages[0].content !== "string") {
		throw new Error("Translation requires one plain-text user message; files and tools are not supported");
	}
	if (maxOutputTokens === undefined) {
		return Math.min(8_192, model.limits.output);
	}
	if (
		!Number.isInteger(maxOutputTokens) ||
		maxOutputTokens < 1 ||
		maxOutputTokens > model.limits.output
	) {
		throw new Error(`maxOutputTokens must be an integer from 1 to ${model.limits.output}`);
	}
	return maxOutputTokens;
}

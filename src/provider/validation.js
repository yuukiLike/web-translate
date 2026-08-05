export function validateGenerationInput({ apiKey, instructions, messages, maxOutputTokens }, model) {
	if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4_096) {
		throw new Error("A valid API key is required");
	}
	if (typeof instructions !== "string" || !instructions.trim()) {
		throw new Error("Translation instructions are required");
	}
	if (!Array.isArray(messages) || messages.length === 0) {
		throw new Error("At least one message is required");
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

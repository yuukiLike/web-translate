import { generateText } from "ai";

import { getCustomEndpoint, getProviderAndModel } from "./catalog.js";
import { createLanguageModel, createProviderGenerationOptions } from "./model.js";
import { createObservedFetch } from "./observed-fetch.js";
import { normalizeTranslationResult } from "./result.js";
import { validateGenerationInput } from "./validation.js";

export async function generateTranslation(request) {
	const {
		providerId,
		apiKey,
		modelId,
		baseUrl,
		instructions,
		messages,
		abortSignal,
		onRequestEvent,
		captureRequestBody,
	} = request;
	const { provider, model } =
		providerId === "custom"
			? getCustomEndpoint(baseUrl, modelId)
			: getProviderAndModel(providerId, modelId);
	const maxOutputTokens = validateGenerationInput(request, model);
	const languageModel = createLanguageModel(
		provider,
		apiKey,
		model.id,
		createObservedFetch(onRequestEvent, {
			captureRequestBody: provider.id === "deepseek" && captureRequestBody === true,
		}),
	);
	const result = await generateText({
		model: languageModel,
		instructions,
		messages,
		abortSignal,
		maxOutputTokens,
		maxRetries: 0,
		...createProviderGenerationOptions(provider.id),
	});
	return normalizeTranslationResult(result);
}

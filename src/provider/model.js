import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

export function createLanguageModel(provider, apiKey, modelId, observedFetch) {
	const options = { apiKey, baseURL: provider.apiBaseURL, fetch: observedFetch };
	switch (provider.id) {
		case "deepseek":
			return createDeepSeek(options)(modelId);
		case "openai":
			return createOpenAI(options)(modelId);
		case "custom":
			return createOpenAI(options).chat(modelId);
		case "google":
			return createGoogle(options)(modelId);
		case "anthropic":
			return createAnthropic(options)(modelId);
		default:
			throw new Error(`Unsupported provider: ${provider.id}`);
	}
}

export function createProviderGenerationOptions(providerId) {
	switch (providerId) {
		case "deepseek":
			return { providerOptions: { deepseek: { thinking: { type: "disabled" } } } };
		case "google":
			return {
				providerOptions: {
					google: {
						thinkingConfig: { includeThoughts: false, thinkingLevel: "minimal" },
					},
				},
			};
		case "openai":
		case "anthropic":
			return { reasoning: "none" };
		case "custom":
			return {};
		default:
			throw new Error(`Unsupported provider: ${providerId}`);
	}
}

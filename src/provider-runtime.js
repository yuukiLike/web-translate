import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import providerAllowlist from "../config/provider-allowlist.json";
import modelCatalog from "../data/models-dev-subset.json";

const providerConfigurationById = new Map(
	providerAllowlist.providers.map((provider) => [provider.id, Object.freeze({ ...provider })]),
);
const modelsByProviderId = new Map(
	modelCatalog.providers.map((provider) => [
		provider.id,
		new Map(provider.models.map((model) => [model.id, Object.freeze({ ...model })])),
	]),
);
let requestSequence = 0;

function getProviderAndModel(providerId, modelId) {
	const provider = providerConfigurationById.get(providerId);
	if (!provider) {
		throw new Error(`Unsupported provider: ${String(providerId)}`);
	}
	const model = modelsByProviderId.get(providerId)?.get(modelId);
	if (!model) {
		throw new Error(`Model ${String(modelId)} is not allowlisted for provider ${providerId}`);
	}
	return { provider, model };
}

function normalizeCustomBaseUrl(value) {
	if (typeof value !== "string") {
		return "";
	}
	const input = value.trim();
	if (!input) {
		return "";
	}
	try {
		const url = new URL(input);
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			return "";
		}
		const localHost =
			url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
		if (url.protocol === "http:" && !localHost) {
			return "";
		}
		if (url.username || url.password) {
			return "";
		}
		const path = url.pathname.replace(/\/+$/u, "");
		return `${url.origin}${path === "/" ? "" : path}`;
	} catch {
		return "";
	}
}

function getCustomEndpoint(baseUrl, modelId) {
	const normalizedBaseUrl = normalizeCustomBaseUrl(baseUrl);
	const model = typeof modelId === "string" ? modelId.trim() : "";
	if (!normalizedBaseUrl) {
		throw new Error("A valid custom base URL is required");
	}
	if (!model || model.length > 300) {
		throw new Error("A valid custom model id is required");
	}
	return {
		provider: Object.freeze({
			id: "custom",
			apiBaseURL: normalizedBaseUrl,
		}),
		model: Object.freeze({
			id: model,
			limits: Object.freeze({ output: 8_192 }),
		}),
	};
}

function assertApiKey(apiKey) {
	if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4096) {
		throw new Error("A valid API key is required");
	}
}

function assertMessages(messages) {
	if (!Array.isArray(messages) || messages.length === 0) {
		throw new Error("At least one message is required");
	}
}

function assertInstructions(instructions) {
	if (typeof instructions !== "string" || !instructions.trim()) {
		throw new Error("Translation instructions are required");
	}
}

function getMaximumOutputTokens(maxOutputTokens, model) {
	if (maxOutputTokens === undefined) {
		return Math.min(8192, model.limits.output);
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

function sanitizeEndpoint(input) {
	let urlValue = "";
	if (typeof input === "string" || input instanceof URL) {
		urlValue = String(input);
	} else if (input && typeof input === "object" && typeof input.url === "string") {
		urlValue = input.url;
	}
	try {
		const url = new URL(urlValue);
		return `${url.origin}${url.pathname}`;
	} catch {
		return "unknown";
	}
}

function getRequestMethod(input, init) {
	if (typeof init?.method === "string" && init.method) {
		return init.method.toUpperCase();
	}
	if (input && typeof input === "object" && typeof input.method === "string" && input.method) {
		return input.method.toUpperCase();
	}
	return "POST";
}

function emitRequestEvent(callback, event) {
	if (typeof callback !== "function") {
		return;
	}
	try {
		const result = callback(Object.freeze(event));
		if (result && typeof result.then === "function") {
			void result.catch(() => {});
		}
	} catch {
		// Observability callbacks must never change request behavior.
	}
}

function isRetryableHttpStatus(status) {
	return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function createObservedFetch(onRequestEvent) {
	const nativeFetch = globalThis.fetch;
	if (typeof nativeFetch !== "function") {
		throw new Error("The Fetch API is unavailable");
	}
	return async (input, init) => {
		requestSequence += 1;
		const requestId = `provider-request-${Date.now()}-${requestSequence}`;
		const endpoint = sanitizeEndpoint(input);
		const method = getRequestMethod(input, init);
		const startedAt = Date.now();
		emitRequestEvent(onRequestEvent, {
			eventType: "request-start",
			requestId,
			endpoint,
			method,
			status: "started",
		});
		try {
			const response = await nativeFetch.call(globalThis, input, init);
			const succeeded = response.ok;
			emitRequestEvent(onRequestEvent, {
				eventType: "request-end",
				requestId,
				endpoint,
				method,
				httpStatus: response.status,
				elapsedMs: Math.max(0, Date.now() - startedAt),
				status: succeeded ? "success" : "error",
				...(succeeded ? {} : { errorCode: `http_${response.status}` }),
				retryable: !succeeded && isRetryableHttpStatus(response.status),
			});
			return response;
		} catch (error) {
			const aborted = error instanceof Error && error.name === "AbortError";
			emitRequestEvent(onRequestEvent, {
				eventType: "request-error",
				requestId,
				endpoint,
				method,
				elapsedMs: Math.max(0, Date.now() - startedAt),
				status: "error",
				errorCode: aborted ? "aborted" : "network_error",
				retryable: !aborted,
			});
			throw error;
		}
	};
}

function createLanguageModel(provider, apiKey, modelId, observedFetch) {
	const options = {
		apiKey,
		baseURL: provider.apiBaseURL,
		fetch: observedFetch,
	};
	switch (provider.id) {
		case "deepseek":
			return createDeepSeek(options)(modelId);
		case "openai":
		case "custom":
			return createOpenAI(options)(modelId);
		case "google":
			return createGoogle(options)(modelId);
		case "anthropic":
			return createAnthropic(options)(modelId);
		default:
			throw new Error(`Unsupported provider: ${provider.id}`);
	}
}

function normalizeTokenCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function createProviderGenerationOptions(providerId) {
	switch (providerId) {
		case "deepseek":
			return {
				providerOptions: {
					deepseek: { thinking: { type: "disabled" } },
				},
			};
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
			// Compatible proxies vary; avoid vendor-specific inference flags.
			return {};
		default:
			throw new Error(`Unsupported provider: ${providerId}`);
	}
}

function normalizeTranslationResult(result) {
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

async function generateTranslation({
	providerId,
	apiKey,
	modelId,
	baseUrl,
	instructions,
	messages,
	abortSignal,
	maxOutputTokens,
	onRequestEvent,
}) {
	const { provider, model } =
		providerId === "custom"
			? getCustomEndpoint(baseUrl, modelId)
			: getProviderAndModel(providerId, modelId);
	assertApiKey(apiKey);
	assertInstructions(instructions);
	assertMessages(messages);
	const outputTokenLimit = getMaximumOutputTokens(maxOutputTokens, model);
	const languageModel = createLanguageModel(
		provider,
		apiKey,
		model.id,
		createObservedFetch(onRequestEvent),
	);
	const result = await generateText({
		model: languageModel,
		instructions,
		messages,
		abortSignal,
		maxOutputTokens: outputTokenLimit,
		maxRetries: 0,
		...createProviderGenerationOptions(provider.id),
	});
	return normalizeTranslationResult(result);
}

globalThis.BilingualTranslatorProviderRuntime = Object.freeze({ generateTranslation });

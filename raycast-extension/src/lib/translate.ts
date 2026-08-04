import { getTranslationCache, type TranslationCacheRequest } from "./cache.ts";
import {
	getLanguageDirection,
	normalizeInput,
	validateTranslationOutput,
	validateTranslationPreferences,
} from "./core.ts";
import { recordDebugEvent } from "./debug.ts";
import { getValidatedPreferences } from "./preferences.ts";
import { ProviderRequestError, translateWithProvider } from "./providers.ts";
import type { TranslateTextOptions, TranslationResult } from "./types.ts";

export async function translateText(
	input: string,
	options: TranslateTextOptions = {},
): Promise<TranslationResult> {
	const startedAt = Date.now();
	const sourceText = normalizeInput(input);
	const preferences = options.preferences
		? validateTranslationPreferences(options.preferences)
		: getValidatedPreferences();
	const direction = getLanguageDirection(sourceText, preferences.targetLanguage);
	const cacheRequest: TranslationCacheRequest = {
		preferences,
		...direction,
		sourceText,
	};
	throwIfAborted(options.signal);
	await safelyRecordDebugEvent(preferences.debugMode, {
		eventType: "translation.started",
		provider: preferences.provider,
		modelId: preferences.modelId,
		...direction,
		sourceCharacters: sourceText.length,
		status: "started",
	});

	if (preferences.cacheEnabled && !options.bypassCache) {
		const cachedTranslation = readCache(cacheRequest, preferences.debugMode);
		if (cachedTranslation !== undefined) {
			const elapsedMs = Math.max(0, Date.now() - startedAt);
			await safelyRecordDebugEvent(preferences.debugMode, {
				eventType: "translation.completed",
				provider: preferences.provider,
				modelId: preferences.modelId,
				...direction,
				sourceCharacters: sourceText.length,
				outputCharacters: cachedTranslation.length,
				elapsedMs,
				cacheHit: true,
				status: "completed",
			});
			return {
				sourceText,
				translatedText: cachedTranslation,
				provider: preferences.provider,
				modelId: preferences.modelId,
				...direction,
				cached: true,
				usage: {},
				elapsedMs,
			};
		}
	}

	try {
		const providerResult = await translateWithProvider({
			preferences,
			sourceText,
			...direction,
			signal: options.signal,
			onEvent: (event) =>
				safelyRecordDebugEvent(preferences.debugMode, {
					provider: preferences.provider,
					modelId: preferences.modelId,
					...direction,
					...event,
				}),
		});
		const translatedText = validateTranslationOutput(providerResult.translatedText, sourceText);
		if (preferences.cacheEnabled) {
			writeCache(cacheRequest, translatedText, preferences.debugMode);
		}
		const elapsedMs = Math.max(0, Date.now() - startedAt);
		await safelyRecordDebugEvent(preferences.debugMode, {
			eventType: "translation.completed",
			provider: preferences.provider,
			modelId: providerResult.modelId,
			...direction,
			sourceCharacters: sourceText.length,
			outputCharacters: translatedText.length,
			inputTokens: providerResult.usage.inputTokens,
			outputTokens: providerResult.usage.outputTokens,
			cacheReadTokens: providerResult.usage.cacheReadTokens,
			billedCharacters: providerResult.usage.billedCharacters,
			elapsedMs,
			cacheHit: false,
			status: "completed",
		});
		return {
			sourceText,
			translatedText,
			provider: preferences.provider,
			modelId: providerResult.modelId,
			...direction,
			cached: false,
			usage: providerResult.usage,
			elapsedMs,
		};
	} catch (error) {
		await safelyRecordDebugEvent(preferences.debugMode, {
			eventType: "translation.failed",
			provider: preferences.provider,
			modelId: preferences.modelId,
			...direction,
			sourceCharacters: sourceText.length,
			elapsedMs: Math.max(0, Date.now() - startedAt),
			errorCode: getSafeErrorCode(error),
			status: error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed",
		});
		throw error;
	}
}

function readCache(request: TranslationCacheRequest, debugMode: boolean): string | undefined {
	try {
		return getTranslationCache().get(request);
	} catch {
		void safelyRecordDebugEvent(debugMode, {
			eventType: "cache.failed",
			provider: request.preferences.provider,
			modelId: request.preferences.modelId,
			sourceLanguage: request.sourceLanguage,
			targetLanguage: request.targetLanguage,
			sourceCharacters: request.sourceText.length,
			errorCode: "CACHE_READ_FAILED",
			status: "failed",
		});
		return undefined;
	}
}

function writeCache(
	request: TranslationCacheRequest,
	translation: string,
	debugMode: boolean,
): void {
	try {
		getTranslationCache().set(request, translation);
	} catch {
		void safelyRecordDebugEvent(debugMode, {
			eventType: "cache.failed",
			provider: request.preferences.provider,
			modelId: request.preferences.modelId,
			sourceLanguage: request.sourceLanguage,
			targetLanguage: request.targetLanguage,
			sourceCharacters: request.sourceText.length,
			errorCode: "CACHE_WRITE_FAILED",
			status: "failed",
		});
	}
}

function getSafeErrorCode(error: unknown): string {
	if (error instanceof ProviderRequestError) {
		return error.code;
	}
	if (error instanceof Error && error.name === "AbortError") {
		return "REQUEST_CANCELLED";
	}
	return "TRANSLATION_FAILED";
}

function safelyRecordDebugEvent(enabled: boolean, event: unknown): Promise<void> {
	return recordDebugEvent(enabled, event).catch(() => undefined);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) {
		return;
	}
	const error = new Error("翻译已取消");
	error.name = "AbortError";
	throw error;
}

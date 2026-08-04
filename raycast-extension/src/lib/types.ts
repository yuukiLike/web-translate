import type { ProviderId } from "../generated/provider-catalog.ts";

export type Language = "en" | "zh";
export type TargetLanguagePreference = "auto" | Language;

export interface LanguageDirection {
	sourceLanguage: Language;
	targetLanguage: Language;
}

export interface TranslationPreferences {
	provider: ProviderId;
	targetLanguage: TargetLanguagePreference;
	apiKey: string;
	azureRegion: string;
	cacheEnabled: boolean;
	debugMode: boolean;
	modelId: string | undefined;
}

export interface TranslationUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cacheReadTokens?: number;
	billedCharacters?: number;
}

export interface TranslationResult extends LanguageDirection {
	sourceText: string;
	translatedText: string;
	provider: ProviderId;
	modelId: string | undefined;
	cached: boolean;
	usage: TranslationUsage;
	elapsedMs: number;
}

export interface TranslateTextOptions {
	preferences?: TranslationPreferences;
	signal?: AbortSignal;
	bypassCache?: boolean;
}

export interface DebugEvent {
	id: string;
	timestamp: string;
	eventType: string;
	provider?: ProviderId;
	modelId?: string;
	sourceLanguage?: Language;
	targetLanguage?: Language;
	status?: string;
	errorCode?: string;
	requestId?: string;
	endpoint?: string;
	attempt?: number;
	httpStatus?: number;
	elapsedMs?: number;
	timeoutMs?: number;
	retryAfterMs?: number;
	sourceCharacters?: number;
	outputCharacters?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	billedCharacters?: number;
	retryable?: boolean;
	cacheHit?: boolean;
}

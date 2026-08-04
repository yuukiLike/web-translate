import { createHash } from "node:crypto";

import { SNAPSHOT } from "../generated/provider-catalog.ts";
import {
	TRANSLATION_PROTOCOL_VERSION,
	getDeepLApiHost,
	isRecord,
	validateTranslationOutput,
} from "./core.ts";
import type { Language, TranslationPreferences } from "./types.ts";

export const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
export const CACHE_CAPACITY_BYTES = 10 * 1_024 * 1_024;

export interface TranslationCacheRequest {
	preferences: TranslationPreferences;
	sourceLanguage: Language;
	targetLanguage: Language;
	sourceText: string;
}

export interface StringCacheStore {
	get(key: string): string | undefined;
	set(key: string, value: string): void;
	remove(key: string): boolean;
	clear(): void;
}

interface StoredTranslation {
	translation: string;
	savedAt: number;
}

export function createTranslationCacheKey(request: TranslationCacheRequest): string {
	const fingerprint = [
		TRANSLATION_PROTOCOL_VERSION,
		SNAPSHOT.commit,
		getProviderCacheSignature(request.preferences),
		request.sourceLanguage,
		request.targetLanguage,
		request.sourceText,
	].join("\u0000");
	return createHash("sha256").update(fingerprint, "utf8").digest("hex");
}

function getProviderCacheSignature(preferences: TranslationPreferences): string {
	if (preferences.provider === "azure") {
		return `azure:${preferences.azureRegion || "global"}`;
	}
	if (preferences.provider === "deepl") {
		return `deepl:${getDeepLApiHost(preferences.apiKey)}`;
	}
	return `${preferences.provider}:${preferences.modelId ?? "unknown"}`;
}

export class TranslationCache {
	readonly store: StringCacheStore;
	readonly now: () => number;

	constructor(store: StringCacheStore, now: () => number = Date.now) {
		this.store = store;
		this.now = now;
	}

	get(request: TranslationCacheRequest): string | undefined {
		const key = createTranslationCacheKey(request);
		const serialized = this.store.get(key);
		if (!serialized) {
			return undefined;
		}
		try {
			const parsed: unknown = JSON.parse(serialized);
			if (!isStoredTranslation(parsed)) {
				this.store.remove(key);
				return undefined;
			}
			const age = this.now() - parsed.savedAt;
			if (age < 0 || age > CACHE_TTL_MS) {
				this.store.remove(key);
				return undefined;
			}
			return validateTranslationOutput(parsed.translation, request.sourceText);
		} catch {
			this.store.remove(key);
			return undefined;
		}
	}

	set(request: TranslationCacheRequest, translation: string): void {
		const entry: StoredTranslation = {
			translation: validateTranslationOutput(translation, request.sourceText),
			savedAt: this.now(),
		};
		this.store.set(createTranslationCacheKey(request), JSON.stringify(entry));
	}

	clear(): void {
		this.store.clear();
	}
}

function isStoredTranslation(value: unknown): value is StoredTranslation {
	return (
		isRecord(value) &&
		typeof value.translation === "string" &&
		typeof value.savedAt === "number" &&
		Number.isFinite(value.savedAt)
	);
}

import {
	CACHE_PREFIX,
	CHAT_TRANSLATION_PROTOCOL_VERSION,
	MAXIMUM_API_KEY_LENGTH,
	MODEL_PROVIDER_IDS,
} from "./constants.js";
import { hashText } from "./text.js";
import { safeString } from "./value-utils.js";

export function createCacheKey(catalog, normalizeSettings) {
	function getProviderSignature(settings) {
		const normalized = normalizeSettings(settings);
		if (MODEL_PROVIDER_IDS.includes(normalized.provider)) {
			return `${normalized.provider}:${normalized[normalized.provider].model}:${CHAT_TRANSLATION_PROTOCOL_VERSION}`;
		}
		switch (normalized.provider) {
			case "azure":
				return `azure:${normalized.azure.region || "global"}`;
			case "deepl":
				return "deepl:latency-optimized-v1";
			case "custom":
				return `custom:${normalized.custom.baseUrl}:${normalized.custom.model}:${CHAT_TRANSLATION_PROTOCOL_VERSION}`;
			default:
				return `${catalog.defaultProviderId}:${catalog.providers[catalog.defaultProviderId].defaultModelId}:${CHAT_TRANSLATION_PROTOCOL_VERSION}`;
		}
	}

	return function cacheKey(
		settings,
		sourceLanguage,
		targetLanguage,
		text,
		cacheScope = "global",
	) {
		const fingerprint = [
			safeString(cacheScope, "global", 500),
			getProviderSignature(settings),
			sourceLanguage,
			targetLanguage,
			text,
		].join("\u0000");
		return `${CACHE_PREFIX}${hashText(fingerprint)}`;
	};
}

export function getDeepLApiHost(apiKey) {
	return safeString(apiKey, "", MAXIMUM_API_KEY_LENGTH).endsWith(":fx")
		? "api-free.deepl.com"
		: "api.deepl.com";
}

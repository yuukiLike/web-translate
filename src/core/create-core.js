import { createCacheKey, getDeepLApiHost } from "./cache.js";
import {
	CACHE_INDEX_KEY,
	CACHE_PREFIX,
	MODEL_PROVIDER_IDS,
	SETTINGS_KEY,
	USAGE_KEY,
} from "./constants.js";
import { parseModelTranslations } from "./model-response.js";
import { createProviderDefinitions } from "./provider-definitions.js";
import { createSettingsApi, normalizeCustomBaseUrl, usesChatTranslation } from "./settings.js";
import {
	batchSegments,
	getLanguagePair,
	getMaximumTranslationLength,
	hashText,
	normalizeSourceText,
	shouldTranslateText,
	splitText,
} from "./text.js";
import { getMonthKey, isRecord } from "./value-utils.js";

export function createCore(catalog) {
	const providerDefinitions = createProviderDefinitions(catalog);
	const settings = createSettingsApi(catalog, providerDefinitions);
	const cacheKey = createCacheKey(catalog, settings.normalizeSettings);

	return Object.freeze({
		CACHE_INDEX_KEY,
		CACHE_PREFIX,
		MODEL_PROVIDER_IDS,
		SETTINGS_KEY,
		USAGE_KEY,
		batchSegments,
		cacheKey,
		createDefaultSettings: settings.createDefaultSettings,
		getCustomApiOrigin: settings.getCustomApiOrigin,
		getDeepLApiHost,
		getLanguagePair,
		getMaximumTranslationLength,
		getMonthKey,
		getProviderConfigurationError: settings.getProviderConfigurationError,
		getProviderLabel: settings.getProviderLabel,
		getProviderLimits: settings.getProviderLimits,
		getProviderMaximumConcurrency: settings.getProviderMaximumConcurrency,
		getProviderModel: settings.getProviderModel,
		hashText,
		isRecord,
		normalizeCustomBaseUrl,
		normalizeSettings: settings.normalizeSettings,
		normalizeSourceText,
		parseModelTranslations,
		publicSettings: settings.publicSettings,
		shouldTranslateText,
		splitText,
		usesChatTranslation,
	});
}

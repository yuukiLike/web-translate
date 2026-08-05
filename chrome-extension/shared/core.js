(() => {
	"use strict";

	if (globalThis.BilingualTranslatorCore) {
		return;
	}
	const MODEL_CATALOG = globalThis.BilingualTranslatorProviderCatalog;
	if (!MODEL_CATALOG || typeof MODEL_CATALOG !== "object" || !MODEL_CATALOG.providers) {
		throw new Error("本地模型目录未加载");
	}
	const MODEL_PROVIDER_IDS = Object.freeze(["deepseek", "openai", "google", "anthropic"]);
	const RECOMMENDED_MODEL_PROVIDERS = Object.freeze(["deepseek", "openai", "google"]);
	const MODEL_PROVIDER_LIMITS = Object.freeze({ maximumCharacters: 8_000, maximumItems: 30 });

	function createModelProviderDefinition(providerId) {
		const provider = MODEL_CATALOG.providers[providerId];
		if (!provider) {
			throw new Error(`本地模型目录缺少 ${providerId}`);
		}
		return Object.freeze({
			configKey: providerId,
			label: provider.name,
			maximumConcurrency: 2,
			limits: MODEL_PROVIDER_LIMITS,
			modelProvider: true,
		});
	}

	const PROVIDER_DEFINITIONS = Object.freeze({
		azure: Object.freeze({
			configKey: "azure",
			label: "Azure Translator",
			maximumConcurrency: 4,
			limits: Object.freeze({ maximumCharacters: 45_000, maximumItems: 100 }),
		}),
		deepl: Object.freeze({
			configKey: "deepl",
			label: "DeepL",
			maximumConcurrency: 4,
			limits: Object.freeze({ maximumCharacters: 24_000, maximumItems: 50 }),
		}),
		deepseek: createModelProviderDefinition("deepseek"),
		openai: createModelProviderDefinition("openai"),
		google: createModelProviderDefinition("google"),
		anthropic: createModelProviderDefinition("anthropic"),
		custom: Object.freeze({
			configKey: "custom",
			label: "自定义",
			maximumConcurrency: 2,
			limits: MODEL_PROVIDER_LIMITS,
			modelProvider: true,
			customEndpoint: true,
		}),
	});
	const PROVIDERS = new Set(Object.keys(PROVIDER_DEFINITIONS));
	const TARGET_MODES = new Set(["auto", "zh", "en"]);
	const CACHE_PREFIX = "translation-cache:";
	const CACHE_INDEX_KEY = "translation-cache-index";
	const SETTINGS_KEY = "settings";
	const USAGE_KEY = "usage";
	const CHAT_TRANSLATION_PROTOCOL_VERSION = "ai-sdk-json-v2";
	const MAXIMUM_API_KEY_LENGTH = 4_096;
	const MAXIMUM_CUSTOM_BASE_URL_LENGTH = 2_048;
	const CUSTOM_DEFAULT_OUTPUT_TOKENS = 8_192;

	function createDefaultModelSettings(providerId) {
		return {
			apiKey: "",
			model: MODEL_CATALOG.providers[providerId].defaultModelId,
		};
	}

	function createDefaultSettings() {
		return {
			provider: MODEL_CATALOG.defaultProviderId,
			targetMode: "auto",
			translateDynamicContent: true,
			concurrency: 2,
			debugLogging: false,
			azure: {
				apiKey: "",
				region: "",
			},
			deepl: {
				apiKey: "",
			},
			deepseek: createDefaultModelSettings("deepseek"),
			openai: createDefaultModelSettings("openai"),
			google: createDefaultModelSettings("google"),
			anthropic: createDefaultModelSettings("anthropic"),
			custom: {
				apiKey: "",
				baseUrl: "",
				model: "",
			},
		};
	}

	function isLocalHttpHost(hostname) {
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
	}

	function normalizeCustomBaseUrl(value) {
		const input = safeString(value, "", MAXIMUM_CUSTOM_BASE_URL_LENGTH);
		if (!input) {
			return "";
		}
		try {
			const url = new URL(input);
			if (url.protocol !== "https:" && url.protocol !== "http:") {
				return "";
			}
			if (url.protocol === "http:" && !isLocalHttpHost(url.hostname)) {
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

	function normalizeCustomSettings(value, defaults) {
		const input = isRecord(value) ? value : {};
		return {
			apiKey: safeString(input.apiKey, "", MAXIMUM_API_KEY_LENGTH),
			baseUrl: normalizeCustomBaseUrl(input.baseUrl) || defaults.baseUrl,
			model: safeString(input.model, defaults.model, 300),
		};
	}

	function getCustomApiOrigin(baseUrl) {
		const normalized = normalizeCustomBaseUrl(baseUrl);
		if (!normalized) {
			return "";
		}
		try {
			return new URL(normalized).origin;
		} catch {
			return "";
		}
	}

	function usesTokenUsage(provider) {
		return MODEL_PROVIDER_IDS.includes(provider) || provider === "custom";
	}

	function usesChatTranslation(provider) {
		return MODEL_PROVIDER_IDS.includes(provider) || provider === "custom";
	}

	function isRecord(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	function safeString(value, fallback = "", maximumLength = 500) {
		return typeof value === "string" ? value.trim().slice(0, maximumLength) : fallback;
	}

	function clampInteger(value, fallback, minimum, maximum) {
		const number = typeof value === "number" ? value : Number.parseInt(String(value), 10);
		return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
	}

	function normalizeModelSettings(value, providerId, defaults) {
		const input = isRecord(value) ? value : {};
		const requestedModel = safeString(input.model, defaults.model, 300) || defaults.model;
		const models = MODEL_CATALOG.providers[providerId].models;
		return {
			apiKey: safeString(input.apiKey, "", MAXIMUM_API_KEY_LENGTH),
			model: Object.hasOwn(models, requestedModel) ? requestedModel : defaults.model,
		};
	}

	function normalizeSettings(input) {
		const defaults = createDefaultSettings();
		const inputSettings = isRecord(input) ? input : {};
		const azureSettings = isRecord(inputSettings.azure) ? inputSettings.azure : {};
		const deepLSettings = isRecord(inputSettings.deepl) ? inputSettings.deepl : {};
		const provider = safeString(inputSettings.provider);
		const targetMode = safeString(inputSettings.targetMode);

		return {
			provider: PROVIDERS.has(provider) ? provider : defaults.provider,
			targetMode: TARGET_MODES.has(targetMode) ? targetMode : defaults.targetMode,
			translateDynamicContent:
				typeof inputSettings.translateDynamicContent === "boolean"
					? inputSettings.translateDynamicContent
					: defaults.translateDynamicContent,
			concurrency: clampInteger(inputSettings.concurrency, defaults.concurrency, 1, 4),
			debugLogging:
				typeof inputSettings.debugLogging === "boolean"
					? inputSettings.debugLogging
					: defaults.debugLogging,
			azure: {
				apiKey: safeString(azureSettings.apiKey, "", MAXIMUM_API_KEY_LENGTH),
				region: safeString(azureSettings.region, "", 100),
			},
			deepl: {
				apiKey: safeString(deepLSettings.apiKey, "", MAXIMUM_API_KEY_LENGTH),
			},
			deepseek: normalizeModelSettings(inputSettings.deepseek, "deepseek", defaults.deepseek),
			openai: normalizeModelSettings(inputSettings.openai, "openai", defaults.openai),
			google: normalizeModelSettings(inputSettings.google, "google", defaults.google),
			anthropic: normalizeModelSettings(inputSettings.anthropic, "anthropic", defaults.anthropic),
			custom: normalizeCustomSettings(inputSettings.custom, defaults.custom),
		};
	}

	function getProviderLabel(providerOrSettings, settingsInput) {
		const settings = isRecord(providerOrSettings)
			? normalizeSettings(providerOrSettings)
			: normalizeSettings(settingsInput);
		const provider = isRecord(providerOrSettings) ? settings.provider : safeString(providerOrSettings);
		return PROVIDER_DEFINITIONS[provider]?.label ?? "未知翻译服务";
	}

	function getProviderMaximumConcurrency(providerOrSettings) {
		const provider = isRecord(providerOrSettings)
			? normalizeSettings(providerOrSettings).provider
			: safeString(providerOrSettings);
		return PROVIDER_DEFINITIONS[provider]?.maximumConcurrency ?? 4;
	}

	function getProviderApiKey(settings) {
		const normalized = normalizeSettings(settings);
		const configKey = PROVIDER_DEFINITIONS[normalized.provider].configKey;
		return normalized[configKey].apiKey;
	}

	function getProviderConfigurationError(settings) {
		const normalized = normalizeSettings(settings);
		const label = getProviderLabel(normalized);
		if (!getProviderApiKey(normalized)) {
			return `请先填写 ${label} API Key`;
		}
		if (normalized.provider === "custom") {
			if (!normalized.custom.baseUrl) {
				return "请填写有效的自定义 Base URL（仅 https，本地可用 http）";
			}
			if (!normalized.custom.model) {
				return "请填写自定义模型 ID";
			}
		}
		return null;
	}

	function publicSettings(settings) {
		const normalized = normalizeSettings(settings);
		return {
			provider: normalized.provider,
			targetMode: normalized.targetMode,
			translateDynamicContent: normalized.translateDynamicContent,
			concurrency: normalized.concurrency,
		};
	}

	function normalizeSourceText(value) {
		return String(value)
			.replace(/\r\n?/g, "\n")
			.replace(/\u00a0/g, " ")
			.replace(/[^\S\n]+/g, " ")
			.replace(/ *\n */g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}

	function normalizeText(value) {
		return normalizeSourceText(value).replace(/\s+/g, " ").trim();
	}

	function normalizeLanguageTag(value) {
		const language = safeString(value).toLowerCase();
		if (language === "zh" || language.startsWith("zh-")) {
			return "zh";
		}
		if (language === "en" || language.startsWith("en-")) {
			return "en";
		}
		return "auto";
	}

	function cjkRatio(value) {
		const text = normalizeText(value);
		if (!text) {
			return 0;
		}
		const cjkCharacters = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
		const meaningfulCharacters = text.match(/[\p{L}\p{N}]/gu)?.length ?? text.length;
		return meaningfulCharacters === 0 ? 0 : cjkCharacters / meaningfulCharacters;
	}

	function getLanguagePair(documentLanguage, sampleText, targetMode = "auto") {
		if (targetMode === "zh") {
			return { sourceLanguage: "en", targetLanguage: "zh" };
		}
		if (targetMode === "en") {
			return { sourceLanguage: "zh", targetLanguage: "en" };
		}
		const declaredLanguage = normalizeLanguageTag(documentLanguage);
		let sourceLanguage = declaredLanguage;
		if (sourceLanguage === "auto") {
			sourceLanguage = cjkRatio(sampleText) >= 0.12 ? "zh" : "en";
		}
		return {
			sourceLanguage,
			targetLanguage: sourceLanguage === "zh" ? "en" : "zh",
		};
	}

	function shouldTranslateText(value, targetLanguage) {
		const text = normalizeText(value);
		if (text.length < 2 || text.length > 30_000) {
			return false;
		}
		if (!/[\p{L}\p{N}]/u.test(text) || /^(?:https?:\/\/|www\.)\S+$/iu.test(text)) {
			return false;
		}
		const ratio = cjkRatio(text);
		return targetLanguage === "zh" ? ratio < 0.35 : ratio >= 0.12;
	}

	function splitText(value, maximumCharacters = 3_500) {
		const text = normalizeSourceText(value);
		if (!text) {
			return [];
		}
		if (text.length <= maximumCharacters) {
			return [text];
		}

		const parts = [];
		let remaining = text;
		while (remaining.length > maximumCharacters) {
			const window = remaining.slice(0, maximumCharacters + 1);
			const preferredSeparators = ["。", "！", "？", ".", "!", "?", "；", ";", "\n"];
			let cut = -1;
			for (const separator of preferredSeparators) {
				cut = Math.max(cut, window.lastIndexOf(separator));
			}
			if (cut < maximumCharacters * 0.55) {
				cut = window.lastIndexOf(" ");
			}
			if (cut < maximumCharacters * 0.4) {
				cut = maximumCharacters;
			} else {
				cut += 1;
			}
			parts.push(remaining.slice(0, cut).trim());
			remaining = remaining.slice(cut).trim();
		}
		if (remaining) {
			parts.push(remaining);
		}
		return parts.filter(Boolean);
	}

	function batchSegments(segments, maximumCharacters, maximumItems) {
		const batches = [];
		let current = [];
		let characterCount = 0;

		for (const segment of segments) {
			const textLength = segment.text.length;
			if (
				current.length > 0 &&
				(current.length >= maximumItems || characterCount + textLength > maximumCharacters)
			) {
				batches.push(current);
				current = [];
				characterCount = 0;
			}
			current.push(segment);
			characterCount += textLength;
		}
		if (current.length > 0) {
			batches.push(current);
		}
		return batches;
	}

	function getProviderLimits(provider) {
		const limits = PROVIDER_DEFINITIONS[provider]?.limits;
		return limits ? { ...limits } : { maximumCharacters: 12_000, maximumItems: 40 };
	}

	function hashText(value) {
		let first = 0x811c9dc5;
		let second = 0x9e3779b9;
		for (let index = 0; index < value.length; index += 1) {
			const code = value.charCodeAt(index);
			first ^= code;
			first = Math.imul(first, 0x01000193);
			second ^= code + ((second << 6) >>> 0) + (second >>> 2);
			second = Math.imul(second, 0x85ebca6b);
		}
		return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
	}

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
				return `${MODEL_CATALOG.defaultProviderId}:${MODEL_CATALOG.providers[MODEL_CATALOG.defaultProviderId].defaultModelId}:${CHAT_TRANSLATION_PROTOCOL_VERSION}`;
		}
	}

	function getProviderModel(settings) {
		const normalized = normalizeSettings(settings);
		if (MODEL_PROVIDER_IDS.includes(normalized.provider)) {
			return normalized[normalized.provider].model;
		}
		if (normalized.provider === "custom") {
			return normalized.custom.model;
		}
		return "";
	}

	function cacheKey(settings, sourceLanguage, targetLanguage, text, cacheScope = "global") {
		const fingerprint = `${safeString(cacheScope, "global", 500)}\u0000${getProviderSignature(settings)}\u0000${sourceLanguage}\u0000${targetLanguage}\u0000${text}`;
		return `${CACHE_PREFIX}${hashText(fingerprint)}`;
	}

	function getDeepLApiHost(apiKey) {
		return safeString(apiKey, "", MAXIMUM_API_KEY_LENGTH).endsWith(":fx")
			? "api-free.deepl.com"
			: "api.deepl.com";
	}

	function getMaximumTranslationLength(sourceLength) {
		return Math.min(20_000, Math.max(2_000, clampInteger(sourceLength, 0, 0, 30_000) * 4));
	}

	function parseModelTranslations(content, expectedIds) {
		const raw = safeString(content, "", 1_000_000).replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
		const firstBrace = raw.indexOf("{");
		const lastBrace = raw.lastIndexOf("}");
		if (firstBrace < 0 || lastBrace <= firstBrace) {
			throw new Error("模型未返回 JSON 对象");
		}
		let parsed;
		try {
			parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
		} catch {
			throw new Error("模型返回的 JSON 无法解析");
		}
		if (!isRecord(parsed) || !Array.isArray(parsed.translations)) {
			throw new Error("模型返回中缺少 translations 数组");
		}
		if (
			parsed.translations.length !== expectedIds.length ||
			!parsed.translations.every(
				(item) => isRecord(item) && typeof item.id === "string" && typeof item.text === "string",
			)
		) {
			throw new Error("模型返回的译文数量与原文不一致");
		}
		const translations = new Map(parsed.translations.map((item) => [item.id, item.text.trim()]));
		if (translations.size !== expectedIds.length || expectedIds.some((id) => !translations.has(id))) {
			throw new Error("模型返回的译文 ID 与原文不一致");
		}
		return expectedIds.map((id) => translations.get(id));
	}

	const parseDeepSeekTranslations = parseModelTranslations;

	function getMonthKey(date = new Date()) {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
	}

	Object.defineProperty(globalThis, "BilingualTranslatorCore", {
		value: Object.freeze({
			CHAT_TRANSLATION_PROTOCOL_VERSION,
			CACHE_INDEX_KEY,
			CACHE_PREFIX,
			CUSTOM_DEFAULT_OUTPUT_TOKENS,
			MODEL_CATALOG,
			MODEL_PROVIDER_IDS,
			PROVIDER_DEFINITIONS,
			RECOMMENDED_MODEL_PROVIDERS,
			SETTINGS_KEY,
			USAGE_KEY,
			batchSegments,
			cacheKey,
			cjkRatio,
			createDefaultSettings,
			getCustomApiOrigin,
			getDeepLApiHost,
			getLanguagePair,
			getMaximumTranslationLength,
			getMonthKey,
			getProviderApiKey,
			getProviderConfigurationError,
			getProviderLabel,
			getProviderLimits,
			getProviderMaximumConcurrency,
			getProviderModel,
			getProviderSignature,
			hashText,
			isRecord,
			normalizeCustomBaseUrl,
			normalizeLanguageTag,
			normalizeSettings,
			normalizeSourceText,
			normalizeText,
			parseDeepSeekTranslations,
			parseModelTranslations,
			publicSettings,
			shouldTranslateText,
			splitText,
			usesChatTranslation,
			usesTokenUsage,
		}),
		configurable: false,
		enumerable: false,
		writable: false,
	});
})();

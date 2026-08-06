import {
	MAXIMUM_API_KEY_LENGTH,
	MAXIMUM_CUSTOM_BASE_URL_LENGTH,
	MODEL_PROVIDER_IDS,
	SOURCE_MODES,
	TARGET_MODES,
} from "./constants.js";
import { clampInteger, isRecord, safeString } from "./value-utils.js";

function isLocalHttpHost(hostname) {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function normalizeCustomBaseUrl(value) {
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

export function createSettingsApi(catalog, providerDefinitions) {
	const providerIds = new Set(Object.keys(providerDefinitions));

	function createDefaultModelSettings(providerId) {
		return {
			apiKey: "",
			model: catalog.providers[providerId].defaultModelId,
		};
	}

	function createDefaultContentFilters() {
		return {
			skipTechnicalIdentifiers: true,
			skipSocialMetadata: true,
			skipShortLinks: true,
			skipShortButtons: true,
		};
	}

	function createDefaultSettings() {
		return {
			provider: catalog.defaultProviderId,
			sourceMode: "auto",
			targetMode: "zh",
			translateDynamicContent: true,
			concurrency: 2,
			contentFilters: createDefaultContentFilters(),
			debugLogging: false,
			debugRequestPayload: false,
			azure: { apiKey: "", region: "" },
			deepl: { apiKey: "" },
			deepseek: createDefaultModelSettings("deepseek"),
			openai: createDefaultModelSettings("openai"),
			google: createDefaultModelSettings("google"),
			anthropic: createDefaultModelSettings("anthropic"),
			custom: { apiKey: "", baseUrl: "", model: "" },
		};
	}

	function normalizeModelSettings(value, providerId, defaults) {
		const input = isRecord(value) ? value : {};
		const requestedModel = safeString(input.model, defaults.model, 300) || defaults.model;
		return {
			apiKey: safeString(input.apiKey, "", MAXIMUM_API_KEY_LENGTH),
			model: Object.hasOwn(catalog.providers[providerId].models, requestedModel)
				? requestedModel
				: defaults.model,
		};
	}

	function normalizeCustomSettings(value, defaults) {
		const input = isRecord(value) ? value : {};
		return {
			apiKey: safeString(input.apiKey, "", MAXIMUM_API_KEY_LENGTH),
			baseUrl: normalizeCustomBaseUrl(input.baseUrl) || defaults.baseUrl,
			model: safeString(input.model, defaults.model, 300),
		};
	}

	function normalizeContentFilters(value, defaults) {
		const input = isRecord(value) ? value : {};
		return {
			skipTechnicalIdentifiers:
				typeof input.skipTechnicalIdentifiers === "boolean"
					? input.skipTechnicalIdentifiers
					: defaults.skipTechnicalIdentifiers,
			skipSocialMetadata:
				typeof input.skipSocialMetadata === "boolean"
					? input.skipSocialMetadata
					: defaults.skipSocialMetadata,
			skipShortLinks:
				typeof input.skipShortLinks === "boolean"
					? input.skipShortLinks
					: defaults.skipShortLinks,
			skipShortButtons:
				typeof input.skipShortButtons === "boolean"
					? input.skipShortButtons
					: defaults.skipShortButtons,
		};
	}

	function normalizeLanguagePair(settings, defaults) {
		const requestedTargetMode = safeString(settings.targetMode);
		if (!Object.hasOwn(settings, "sourceMode")) {
			// 旧版把方向复用在 targetMode 中；读取时一次性迁移到两个独立字段。
			switch (requestedTargetMode) {
				case "zh":
					return { sourceMode: "en", targetMode: "zh" };
				case "en":
					return { sourceMode: "zh", targetMode: "en" };
				default:
					return { sourceMode: defaults.sourceMode, targetMode: defaults.targetMode };
			}
		}

		const requestedSourceMode = safeString(settings.sourceMode);
		const sourceMode = SOURCE_MODES.has(requestedSourceMode)
			? requestedSourceMode
			: defaults.sourceMode;
		const targetMode = TARGET_MODES.has(requestedTargetMode)
			? requestedTargetMode
			: defaults.targetMode;
		if (sourceMode !== "auto" && sourceMode === targetMode) {
			// 同语种显式方向没有翻译意义；保留目标并改为自动识别来源。
			return { sourceMode: "auto", targetMode };
		}
		return { sourceMode, targetMode };
	}

	function normalizeSettings(input) {
		const defaults = createDefaultSettings();
		const settings = isRecord(input) ? input : {};
		const azure = isRecord(settings.azure) ? settings.azure : {};
		const deepl = isRecord(settings.deepl) ? settings.deepl : {};
		const provider = safeString(settings.provider);
		const languagePair = normalizeLanguagePair(settings, defaults);
		const debugLogging = settings.debugLogging === true;
		return {
			provider: providerIds.has(provider) ? provider : defaults.provider,
			...languagePair,
			translateDynamicContent:
				typeof settings.translateDynamicContent === "boolean"
					? settings.translateDynamicContent
					: defaults.translateDynamicContent,
			concurrency: clampInteger(settings.concurrency, defaults.concurrency, 1, 4),
			contentFilters: normalizeContentFilters(
				settings.contentFilters,
				defaults.contentFilters,
			),
			debugLogging,
			debugRequestPayload: debugLogging && settings.debugRequestPayload === true,
			azure: {
				apiKey: safeString(azure.apiKey, "", MAXIMUM_API_KEY_LENGTH),
				region: safeString(azure.region, "", 100),
			},
			deepl: { apiKey: safeString(deepl.apiKey, "", MAXIMUM_API_KEY_LENGTH) },
			deepseek: normalizeModelSettings(settings.deepseek, "deepseek", defaults.deepseek),
			openai: normalizeModelSettings(settings.openai, "openai", defaults.openai),
			google: normalizeModelSettings(settings.google, "google", defaults.google),
			anthropic: normalizeModelSettings(settings.anthropic, "anthropic", defaults.anthropic),
			custom: normalizeCustomSettings(settings.custom, defaults.custom),
		};
	}

	function getProviderLabel(providerOrSettings, settingsInput) {
		const settings = isRecord(providerOrSettings)
			? normalizeSettings(providerOrSettings)
			: normalizeSettings(settingsInput);
		const provider = isRecord(providerOrSettings)
			? settings.provider
			: safeString(providerOrSettings);
		return providerDefinitions[provider]?.label ?? "未知翻译服务";
	}

	function getProviderMaximumConcurrency(providerOrSettings) {
		const provider = isRecord(providerOrSettings)
			? normalizeSettings(providerOrSettings).provider
			: safeString(providerOrSettings);
		return providerDefinitions[provider]?.maximumConcurrency ?? 4;
	}

	function getProviderConfigurationError(settings) {
		const normalized = normalizeSettings(settings);
		const configKey = providerDefinitions[normalized.provider].configKey;
		if (!normalized[configKey].apiKey) {
			return `请先填写 ${getProviderLabel(normalized)} API Key`;
		}
		if (normalized.provider === "custom" && !normalized.custom.baseUrl) {
			return "请填写有效的自定义 Base URL（仅 https，本地可用 http）";
		}
		if (normalized.provider === "custom" && !normalized.custom.model) {
			return "请填写自定义模型 ID";
		}
		return null;
	}

	function getCustomApiOrigin(baseUrl) {
		const normalized = normalizeCustomBaseUrl(baseUrl);
		if (!normalized) {
			return "";
		}
		return new URL(normalized).origin;
	}

	function getProviderModel(settings) {
		const normalized = normalizeSettings(settings);
		if (MODEL_PROVIDER_IDS.includes(normalized.provider)) {
			return normalized[normalized.provider].model;
		}
		return normalized.provider === "custom" ? normalized.custom.model : "";
	}

	function getProviderLimits(provider) {
		const limits = providerDefinitions[provider]?.limits;
		return limits ? { ...limits } : { maximumCharacters: 12_000, maximumItems: 40 };
	}

	function publicSettings(settings) {
		const normalized = normalizeSettings(settings);
		return {
			provider: normalized.provider,
			sourceMode: normalized.sourceMode,
			targetMode: normalized.targetMode,
			translateDynamicContent: normalized.translateDynamicContent,
			concurrency: normalized.concurrency,
			contentFilters: { ...normalized.contentFilters },
		};
	}

	return {
		createDefaultSettings,
		getCustomApiOrigin,
		getProviderConfigurationError,
		getProviderLabel,
		getProviderLimits,
		getProviderMaximumConcurrency,
		getProviderModel,
		normalizeSettings,
		publicSettings,
	};
}

export function usesChatTranslation(provider) {
	return MODEL_PROVIDER_IDS.includes(provider) || provider === "custom";
}

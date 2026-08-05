import { SAFE_ENDPOINT_SUFFIXES } from "./constants.js";
import { sumSegmentCharacters } from "./utilities.js";

export function createDebugMetadata({ core, providerCatalog, extensionVersion }) {
	const safeApiOrigins = new Set([
		"https://api.cognitive.microsofttranslator.com",
		"https://api-free.deepl.com",
		"https://api.deepl.com",
		...Object.values(providerCatalog.providers).map(
			(provider) => new URL(provider.apiBaseURL).origin,
		),
	]);

	function getProviderAdapter(settings) {
		if (core.MODEL_PROVIDER_IDS.includes(settings.provider)) {
			return providerCatalog.providers[settings.provider].sdkPackage;
		}
		if (settings.provider === "custom") {
			return "@ai-sdk/openai:chat-custom";
		}
		return `${settings.provider}-rest`;
	}

	function getProviderApiHost(settings) {
		let baseUrl;
		if (core.MODEL_PROVIDER_IDS.includes(settings.provider)) {
			baseUrl = providerCatalog.providers[settings.provider].apiBaseURL;
		} else if (settings.provider === "custom") {
			baseUrl = settings.custom.baseUrl;
		} else if (settings.provider === "azure") {
			baseUrl = "https://api.cognitive.microsofttranslator.com";
		} else if (settings.provider === "deepl") {
			baseUrl = `https://${core.getDeepLApiHost(settings.deepl.apiKey)}`;
		}
		try {
			return new URL(baseUrl).host;
		} catch {
			return "";
		}
	}

	function getProviderInferencePolicy(settings) {
		switch (settings.provider) {
			case "deepseek":
				return "thinking-disabled";
			case "openai":
			case "anthropic":
				return "reasoning-none";
			case "custom":
				return "provider-default";
			case "google":
				return "thinking-minimal";
			default:
				return "native-translation-api";
		}
	}

	function createProviderContext(settings, operation) {
		return {
			component: "provider",
			provider: settings.provider,
			model: core.getProviderModel(settings),
			extensionVersion,
			providerAdapter: getProviderAdapter(settings),
			apiHost: getProviderApiHost(settings),
			inferencePolicy: getProviderInferencePolicy(settings),
			catalogSourceSha: core.MODEL_PROVIDER_IDS.includes(settings.provider)
				? providerCatalog.source.commit
				: "",
			operation,
		};
	}

	function createRequestContext(
		settings,
		operation,
		sourceLanguage,
		targetLanguage,
		segments,
		metadata = {},
	) {
		return {
			...createProviderContext(settings, operation),
			sourceLanguage,
			targetLanguage,
			segmentCount: segments.length,
			sourceCharacters: sumSegmentCharacters(segments),
			...metadata,
		};
	}

	function getSafeEndpoint(value) {
		try {
			const url = new URL(value);
			if (safeApiOrigins.has(url.origin)) {
				return `${url.origin}${url.pathname.slice(0, 500)}`;
			}
			const suffix = SAFE_ENDPOINT_SUFFIXES.find((candidate) =>
				url.pathname.endsWith(candidate),
			);
			return `${url.origin}${suffix ?? "/"}`;
		} catch {
			return "invalid-url";
		}
	}

	return {
		createProviderContext,
		createRequestContext,
		getProviderAdapter,
		getProviderApiHost,
		getSafeEndpoint,
	};
}

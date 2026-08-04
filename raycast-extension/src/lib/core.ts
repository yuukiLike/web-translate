import {
	DEFAULT_PROVIDER_ID,
	MODEL_PROVIDERS,
	PROVIDER_IDS,
	type ModelCatalogEntry,
	type ModelProviderId,
	type ProviderId,
} from "../generated/provider-catalog.ts";
import type {
	LanguageDirection,
	TargetLanguagePreference,
	TranslationPreferences,
} from "./types.ts";

export const MAXIMUM_API_KEY_LENGTH = 4_096;
export const MAXIMUM_INPUT_CHARACTERS = 30_000;
export const TRANSLATION_PROTOCOL_VERSION = "raycast-json-v1";

const TARGET_LANGUAGES = new Set<TargetLanguagePreference>(["auto", "en", "zh"]);
const PROVIDERS = new Set<string>(PROVIDER_IDS);
const MODEL_PROVIDER_MAP = new Map<ModelProviderId, ModelCatalogEntry>(
	MODEL_PROVIDERS.map((provider) => [provider.id, provider]),
);
const API_KEY_FIELDS = {
	azure: "azureApiKey",
	deepl: "deeplApiKey",
	deepseek: "deepseekApiKey",
	openai: "openaiApiKey",
	google: "googleApiKey",
	anthropic: "anthropicApiKey",
} as const satisfies Record<ProviderId, string>;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown, maximumLength: number): string {
	return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function containsControlCharacters(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= 31 || codePoint === 127) {
			return true;
		}
	}
	return false;
}

export function isProviderId(value: unknown): value is ProviderId {
	return typeof value === "string" && PROVIDERS.has(value);
}

export function isModelProviderId(value: ProviderId): value is ModelProviderId {
	return MODEL_PROVIDER_MAP.has(value as ModelProviderId);
}

export function getModelProvider(providerId: ModelProviderId): ModelCatalogEntry {
	const provider = MODEL_PROVIDER_MAP.get(providerId);
	if (!provider) {
		throw new Error(`不支持的模型 Provider：${providerId}`);
	}
	return provider;
}

export function normalizeInput(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("请输入需要翻译的文本");
	}
	const text = value
		.replace(/\r\n?/gu, "\n")
		.replace(/\u00a0/gu, " ")
		.replace(/[^\S\n]+/gu, " ")
		.replace(/ *\n */gu, "\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
	if (!text) {
		throw new Error("请输入需要翻译的文本");
	}
	if (text.length > MAXIMUM_INPUT_CHARACTERS) {
		throw new Error(`单次最多翻译 ${MAXIMUM_INPUT_CHARACTERS.toLocaleString()} 个字符`);
	}
	if (!/[\p{L}\p{N}]/u.test(text)) {
		throw new Error("文本中没有可翻译的内容");
	}
	return text;
}

export function getCjkRatio(value: string): number {
	const text = value.replace(/\s+/gu, " ").trim();
	if (!text) {
		return 0;
	}
	const cjkCharacters = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
	const meaningfulCharacters = text.match(/[\p{L}\p{N}]/gu)?.length ?? text.length;
	return meaningfulCharacters === 0 ? 0 : cjkCharacters / meaningfulCharacters;
}

export function getLanguageDirection(
	text: string,
	targetLanguage: TargetLanguagePreference,
): LanguageDirection {
	if (!TARGET_LANGUAGES.has(targetLanguage)) {
		throw new Error("翻译方向设置无效");
	}
	if (targetLanguage === "zh") {
		return { sourceLanguage: "en", targetLanguage: "zh" };
	}
	if (targetLanguage === "en") {
		return { sourceLanguage: "zh", targetLanguage: "en" };
	}
	const sourceLanguage = getCjkRatio(text) >= 0.12 ? "zh" : "en";
	return {
		sourceLanguage,
		targetLanguage: sourceLanguage === "zh" ? "en" : "zh",
	};
}

export function normalizePreferences(value: unknown): TranslationPreferences {
	const preferences = isRecord(value) ? value : {};
	const rawProvider = preferences.provider ?? DEFAULT_PROVIDER_ID;
	if (!isProviderId(rawProvider)) {
		throw new Error("请选择受支持的翻译 Provider");
	}
	const rawTargetLanguage = preferences.targetLanguage ?? "auto";
	if (
		typeof rawTargetLanguage !== "string" ||
		!TARGET_LANGUAGES.has(rawTargetLanguage as TargetLanguagePreference)
	) {
		throw new Error("请选择有效的翻译方向");
	}
	const targetLanguage = rawTargetLanguage as TargetLanguagePreference;
	const apiKey = readTrimmedString(
		preferences[API_KEY_FIELDS[rawProvider]],
		MAXIMUM_API_KEY_LENGTH + 1,
	);
	if (!apiKey || apiKey.length > MAXIMUM_API_KEY_LENGTH || containsControlCharacters(apiKey)) {
		throw new Error(`请先填写 ${getProviderName(rawProvider)} API Key`);
	}
	const azureRegion = readTrimmedString(preferences.azureRegion, 101);
	if (
		rawProvider === "azure" &&
		(azureRegion.length > 100 || (azureRegion && !/^[a-z0-9-]+$/iu.test(azureRegion)))
	) {
		throw new Error("Azure 资源区域格式无效");
	}
	const modelId = isModelProviderId(rawProvider)
		? getModelProvider(rawProvider).defaultModelId
		: undefined;
	return validateTranslationPreferences({
		provider: rawProvider,
		targetLanguage,
		apiKey,
		azureRegion,
		cacheEnabled: typeof preferences.cacheEnabled === "boolean" ? preferences.cacheEnabled : true,
		debugMode: typeof preferences.debugMode === "boolean" ? preferences.debugMode : false,
		modelId,
	});
}

export function validateTranslationPreferences(value: unknown): TranslationPreferences {
	if (!isRecord(value) || !isProviderId(value.provider)) {
		throw new Error("请选择受支持的翻译 Provider");
	}
	if (
		typeof value.targetLanguage !== "string" ||
		!TARGET_LANGUAGES.has(value.targetLanguage as TargetLanguagePreference)
	) {
		throw new Error("请选择有效的翻译方向");
	}
	if (
		typeof value.apiKey !== "string" ||
		!value.apiKey ||
		value.apiKey.length > MAXIMUM_API_KEY_LENGTH ||
		containsControlCharacters(value.apiKey)
	) {
		throw new Error(`请先填写 ${getProviderName(value.provider)} API Key`);
	}
	const azureRegion = typeof value.azureRegion === "string" ? value.azureRegion : "";
	if (
		value.provider === "azure" &&
		(azureRegion.length > 100 || (azureRegion && !/^[a-z0-9-]+$/iu.test(azureRegion)))
	) {
		throw new Error("Azure 资源区域格式无效");
	}
	const expectedModelId = isModelProviderId(value.provider)
		? getModelProvider(value.provider).defaultModelId
		: undefined;
	if (value.modelId !== expectedModelId) {
		throw new Error("当前模型不在本地 allowlist 中");
	}
	if (typeof value.cacheEnabled !== "boolean" || typeof value.debugMode !== "boolean") {
		throw new Error("Raycast 偏好设置格式无效");
	}
	return {
		provider: value.provider,
		targetLanguage: value.targetLanguage as TargetLanguagePreference,
		apiKey: value.apiKey,
		azureRegion,
		cacheEnabled: value.cacheEnabled,
		debugMode: value.debugMode,
		modelId: expectedModelId,
	};
}

export function getProviderName(providerId: ProviderId): string {
	if (providerId === "azure") {
		return "Azure Translator";
	}
	if (providerId === "deepl") {
		return "DeepL";
	}
	return getModelProvider(providerId).name;
}

export function getDeepLApiHost(apiKey: string): "api-free.deepl.com" | "api.deepl.com" {
	return apiKey.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
}

export function getMaximumTranslationLength(sourceLength: number): number {
	const boundedLength = Number.isFinite(sourceLength)
		? Math.min(MAXIMUM_INPUT_CHARACTERS, Math.max(0, Math.round(sourceLength)))
		: 0;
	return Math.min(MAXIMUM_INPUT_CHARACTERS * 8, Math.max(2_000, boundedLength * 8));
}

export function validateTranslationOutput(value: unknown, sourceText: string): string {
	if (typeof value !== "string") {
		throw new Error("翻译服务返回了无效译文");
	}
	const translation = value.trim();
	if (!translation || translation.length > getMaximumTranslationLength(sourceText.length)) {
		throw new Error("翻译服务返回的译文长度异常");
	}
	return translation;
}

export function parseModelTranslation(content: unknown, sourceText: string): string {
	if (typeof content !== "string") {
		throw new Error("模型未返回译文");
	}
	const raw = content
		.trim()
		.replace(/^```(?:json)?\s*/iu, "")
		.replace(/\s*```$/u, "");
	const firstBrace = raw.indexOf("{");
	const lastBrace = raw.lastIndexOf("}");
	if (firstBrace < 0 || lastBrace <= firstBrace) {
		throw new Error("模型未返回 JSON 对象");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
	} catch {
		throw new Error("模型返回的 JSON 无法解析");
	}
	if (
		!isRecord(parsed) ||
		!Array.isArray(parsed.translations) ||
		parsed.translations.length !== 1
	) {
		throw new Error("模型返回的译文数量与原文不一致");
	}
	const item = parsed.translations[0];
	if (!isRecord(item) || item.id !== "translation") {
		throw new Error("模型返回的译文 ID 与原文不一致");
	}
	return validateTranslationOutput(item.text, sourceText);
}

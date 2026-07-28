(() => {
	"use strict";

	if (globalThis.BilingualTranslatorCore) {
		return;
	}

	const PROVIDERS = new Set(["azure", "deepl", "deepseek"]);
	const TARGET_MODES = new Set(["auto", "zh", "en"]);
	const CACHE_PREFIX = "translation-cache:";
	const CACHE_INDEX_KEY = "translation-cache-index";
	const SETTINGS_KEY = "settings";
	const USAGE_KEY = "usage";

	function createDefaultSettings() {
		return {
			provider: "azure",
			targetMode: "auto",
			translateDynamicContent: true,
			concurrency: 2,
			azure: {
				apiKey: "",
				region: "",
			},
			deepl: {
				apiKey: "",
			},
			deepseek: {
				apiKey: "",
				model: "deepseek-v4-flash",
			},
		};
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

	function normalizeSettings(input) {
		const defaults = createDefaultSettings();
		const value = isRecord(input) ? input : {};
		const azure = isRecord(value.azure) ? value.azure : {};
		const deepl = isRecord(value.deepl) ? value.deepl : {};
		const deepseek = isRecord(value.deepseek) ? value.deepseek : {};
		const provider = safeString(value.provider);
		const targetMode = safeString(value.targetMode);

		return {
			provider: PROVIDERS.has(provider) ? provider : defaults.provider,
			targetMode: TARGET_MODES.has(targetMode) ? targetMode : defaults.targetMode,
			translateDynamicContent:
				typeof value.translateDynamicContent === "boolean"
					? value.translateDynamicContent
					: defaults.translateDynamicContent,
			concurrency: clampInteger(value.concurrency, defaults.concurrency, 1, 4),
			azure: {
				apiKey: safeString(azure.apiKey, "", 300),
				region: safeString(azure.region, "", 100),
			},
			deepl: {
				apiKey: safeString(deepl.apiKey, "", 300),
			},
			deepseek: {
				apiKey: safeString(deepseek.apiKey, "", 300),
				model: safeString(deepseek.model, defaults.deepseek.model, 100) || defaults.deepseek.model,
			},
		};
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
		const sourceLanguage = declaredLanguage === "auto" ? (cjkRatio(sampleText) >= 0.12 ? "zh" : "en") : declaredLanguage;
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
		switch (provider) {
			case "azure":
				return { maximumCharacters: 45_000, maximumItems: 100 };
			case "deepl":
				return { maximumCharacters: 24_000, maximumItems: 50 };
			case "deepseek":
				return { maximumCharacters: 8_000, maximumItems: 30 };
			default:
				return { maximumCharacters: 12_000, maximumItems: 40 };
		}
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
		switch (normalized.provider) {
			case "azure":
				return `azure:${normalized.azure.region || "global"}`;
			case "deepl":
				return "deepl:latency-optimized-v1";
			case "deepseek":
				return `deepseek:${normalized.deepseek.model}`;
			default:
				return "azure:global";
		}
	}

	function cacheKey(settings, sourceLanguage, targetLanguage, text, cacheScope = "global") {
		const fingerprint = `${safeString(cacheScope, "global", 500)}\u0000${getProviderSignature(settings)}\u0000${sourceLanguage}\u0000${targetLanguage}\u0000${text}`;
		return `${CACHE_PREFIX}${hashText(fingerprint)}`;
	}

	function getDeepLApiHost(apiKey) {
		return safeString(apiKey, "", 300).endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
	}

	function getMaximumTranslationLength(sourceLength) {
		return Math.min(20_000, Math.max(2_000, clampInteger(sourceLength, 0, 0, 30_000) * 4));
	}

	function parseDeepSeekTranslations(content, expectedIds) {
		const raw = safeString(content, "", 1_000_000).replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
		const firstBrace = raw.indexOf("{");
		const lastBrace = raw.lastIndexOf("}");
		if (firstBrace < 0 || lastBrace <= firstBrace) {
			throw new Error("DeepSeek 未返回 JSON 对象");
		}
		let parsed;
		try {
			parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
		} catch {
			throw new Error("DeepSeek 返回的 JSON 无法解析");
		}
		if (!isRecord(parsed) || !Array.isArray(parsed.translations)) {
			throw new Error("DeepSeek 返回中缺少 translations 数组");
		}
		if (
			parsed.translations.length !== expectedIds.length ||
			!parsed.translations.every(
				(item) => isRecord(item) && typeof item.id === "string" && typeof item.text === "string",
			)
		) {
			throw new Error("DeepSeek 返回的译文数量与原文不一致");
		}
		const translations = new Map(parsed.translations.map((item) => [item.id, item.text.trim()]));
		if (translations.size !== expectedIds.length || expectedIds.some((id) => !translations.has(id))) {
			throw new Error("DeepSeek 返回的译文 ID 与原文不一致");
		}
		return expectedIds.map((id) => translations.get(id));
	}

	function getMonthKey(date = new Date()) {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
	}

	Object.defineProperty(globalThis, "BilingualTranslatorCore", {
		value: Object.freeze({
			CACHE_INDEX_KEY,
			CACHE_PREFIX,
			SETTINGS_KEY,
			USAGE_KEY,
			batchSegments,
			cacheKey,
			cjkRatio,
			createDefaultSettings,
			getDeepLApiHost,
			getLanguagePair,
			getMaximumTranslationLength,
			getMonthKey,
			getProviderLimits,
			getProviderSignature,
			hashText,
			isRecord,
			normalizeLanguageTag,
			normalizeSettings,
			normalizeSourceText,
			normalizeText,
			parseDeepSeekTranslations,
			publicSettings,
			shouldTranslateText,
			splitText,
		}),
		configurable: false,
		enumerable: false,
		writable: false,
	});
})();

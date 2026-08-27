import { sumSegmentCharacters } from "../utilities.js";

export function createRestTranslators({ core, jsonClient, debugMetadata }) {
	async function translateWithAzure(
		settings,
		sourceLanguage,
		targetLanguage,
		segments,
		signal,
		debugMetadataFields = {},
	) {
		const query = new URLSearchParams({
			"api-version": "3.0",
			from: sourceLanguage === "zh" ? "zh-Hans" : "en",
			to: targetLanguage === "zh" ? "zh-Hans" : "en",
		});
		const headers = {
			"Content-Type": "application/json",
			"Ocp-Apim-Subscription-Key": settings.azure.apiKey,
		};
		if (settings.azure.region) {
			headers["Ocp-Apim-Subscription-Region"] = settings.azure.region;
		}
		const data = await jsonClient.fetchJsonWithRetry(
			`https://api.cognitive.microsofttranslator.com/translate?${query}`,
			{
				method: "POST",
				headers,
				body: JSON.stringify(segments.map((segment) => ({ Text: segment.text }))),
			},
			signal,
			{
				debug: debugMetadata.createRequestContext(
					settings,
					"translate",
					sourceLanguage,
					targetLanguage,
					segments,
					debugMetadataFields,
				),
			},
		);
		if (
			!Array.isArray(data) ||
			data.length !== segments.length ||
			!data.every(
				(item) =>
					Array.isArray(item.translations) &&
					typeof item.translations[0]?.text === "string",
			)
		) {
			throw new Error("Azure 返回格式无效");
		}
		return {
			translations: data.map((item) => item.translations[0].text.trim()),
			usage: {
				billedCharacters: sumSegmentCharacters(segments),
			},
		};
	}

	async function translateWithDeepL(
		settings,
		sourceLanguage,
		targetLanguage,
		segments,
		signal,
		debugMetadataFields = {},
	) {
		const host = core.getDeepLApiHost(settings.deepl.apiKey);
		const data = await jsonClient.fetchJsonWithRetry(
			`https://${host}/v2/translate`,
			{
				method: "POST",
				headers: {
					Authorization: `DeepL-Auth-Key ${settings.deepl.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					text: segments.map((segment) => segment.text),
					source_lang: sourceLanguage.toUpperCase(),
					target_lang: targetLanguage === "zh" ? "ZH-HANS" : "EN-US",
					model_type: "latency_optimized",
					show_billed_characters: true,
				}),
			},
			signal,
			{
				debug: debugMetadata.createRequestContext(
					settings,
					"translate",
					sourceLanguage,
					targetLanguage,
					segments,
					debugMetadataFields,
				),
			},
		);
		if (
			!core.isRecord(data) ||
			!Array.isArray(data.translations) ||
			data.translations.length !== segments.length ||
			!data.translations.every((item) => typeof item.text === "string")
		) {
			throw new Error("DeepL 返回格式无效");
		}
		return {
			translations: data.translations.map((item) => item.text.trim()),
			usage: {
				billedCharacters: data.translations.reduce(
					(sum, item, index) =>
						sum +
						(typeof item.billed_characters === "number"
							? item.billed_characters
							: segments[index].text.length),
					0,
				),
			},
		};
	}

	return { translateWithAzure, translateWithDeepL };
}

import { MODEL_PROVIDER_IDS } from "./constants.js";

const MODEL_PROVIDER_LIMITS = Object.freeze({
	maximumCharacters: 8_000,
	maximumItems: 30,
});

function createModelProviderDefinition(catalog, providerId) {
	const provider = catalog.providers[providerId];
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

export function createProviderDefinitions(catalog) {
	if (!catalog || typeof catalog !== "object" || !catalog.providers) {
		throw new Error("本地模型目录未加载");
	}

	const modelProviders = Object.fromEntries(
		MODEL_PROVIDER_IDS.map((providerId) => [
			providerId,
			createModelProviderDefinition(catalog, providerId),
		]),
	);

	return Object.freeze({
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
		...modelProviders,
		custom: Object.freeze({
			configKey: "custom",
			label: "自定义",
			maximumConcurrency: 2,
			limits: MODEL_PROVIDER_LIMITS,
			modelProvider: true,
			customEndpoint: true,
		}),
	});
}

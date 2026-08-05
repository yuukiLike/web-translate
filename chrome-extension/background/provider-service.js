export function createProviderService({
	core,
	jsonClient,
	modelTranslator,
	restTranslators,
	debugMetadata,
	assertProviderConfigured,
	assertProviderPermission,
}) {
	async function translate(
		settings,
		sourceLanguage,
		targetLanguage,
		segments,
		signal,
		debugFields = {},
	) {
		if (core.usesChatTranslation(settings.provider)) {
			return await modelTranslator.translate(
				settings,
				sourceLanguage,
				targetLanguage,
				segments,
				signal,
				debugFields,
			);
		}
		switch (settings.provider) {
			case "azure":
				return await restTranslators.translateWithAzure(
					settings,
					sourceLanguage,
					targetLanguage,
					segments,
					signal,
					debugFields,
				);
			case "deepl":
				return await restTranslators.translateWithDeepL(
					settings,
					sourceLanguage,
					targetLanguage,
					segments,
					signal,
					debugFields,
				);
			default:
				throw new Error("未知云翻译服务");
		}
	}

	async function test(settings) {
		assertProviderConfigured(settings);
		const controller = new AbortController();
		if (settings.provider === "deepl") {
			const host = core.getDeepLApiHost(settings.deepl.apiKey);
			await jsonClient.fetchJsonWithRetry(
				`https://${host}/v2/usage`,
				{ headers: { Authorization: `DeepL-Auth-Key ${settings.deepl.apiKey}` } },
				controller.signal,
				{ debug: debugMetadata.createProviderContext(settings, "connection.test") },
			);
		} else if (core.usesChatTranslation(settings.provider)) {
			await assertProviderPermission(settings);
			await modelTranslator.translate(
				settings,
				"en",
				"zh",
				[{ id: "test", text: "hello" }],
				controller.signal,
				{ incognito: false },
			);
		} else {
			await restTranslators.translateWithAzure(
				settings,
				"en",
				"zh",
				[{ id: "test", text: "hello" }],
				controller.signal,
			);
		}
		return { message: `${core.getProviderLabel(settings)} 连接成功` };
	}

	return { test, translate };
}

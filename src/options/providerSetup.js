export function createProviderSetup({ core, permissions, sendMessage }) {
	async function ensureCustomHostPermission(settings) {
		if (settings.provider !== "custom") return;
		const origin = core.getCustomApiOrigin(settings.custom.baseUrl);
		if (!origin) throw new Error("自定义 Base URL 无效");
		if (typeof permissions?.request !== "function") return;

		const origins = [`${origin}/*`];
		if (typeof permissions.contains === "function" && (await permissions.contains({ origins }))) {
			return;
		}
		if (!(await permissions.request({ origins }))) {
			throw new Error("需要授权访问该自定义 API 域名");
		}
	}

	async function saveSettings(draft) {
		const settings = core.normalizeSettings(draft);
		const configurationError = core.getProviderConfigurationError(settings);
		if (configurationError) throw new Error(configurationError);
		await ensureCustomHostPermission(settings);

		// 语言有独立的写入入口；完整设置保存不得覆盖其他页面刚保存的方向。
		await sendMessage({
			type: "SET_LANGUAGE_PAIR",
			sourceMode: settings.sourceMode,
			targetLanguage: settings.targetMode,
		});
		const saved = await sendMessage({ type: "SAVE_SETTINGS", settings });
		return saved.settings;
	}

	async function testConnection() {
		const tested = await sendMessage({ type: "TEST_PROVIDER" });
		const refreshed = await sendMessage({ type: "GET_OPTIONS_STATE" });
		return {
			message: typeof tested.message === "string" ? tested.message : "连接测试完成",
			usage: refreshed.usage,
		};
	}

	return { saveSettings, testConnection };
}

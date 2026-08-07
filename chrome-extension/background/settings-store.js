import { createSerialTaskQueue } from "./utilities.js";

export function createSettingsStore({
	chrome,
	core,
	providerCatalog,
	onDebugLoggingChanged,
	onDebugRequestPayloadChanged = () => {},
}) {
	const writeQueue = createSerialTaskQueue();
	let ready;

	function initialize() {
		ready ??= initializeSecureStorage();
		return ready;
	}

	async function initializeSecureStorage() {
		if (typeof chrome.storage.local.setAccessLevel !== "function") {
			throw new Error("当前 Chrome 版本无法安全保存 API Key，请升级浏览器");
		}
		await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
		if (typeof chrome.storage.session.setAccessLevel === "function") {
			await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
		}
		await ensureStoredSettings();
		const settings = await getSettings();
		await notifyDebugSettings(settings);
		return settings;
	}

	async function ensureStoredSettings() {
		const stored = await chrome.storage.local.get(core.SETTINGS_KEY);
		if (!stored[core.SETTINGS_KEY]) {
			await chrome.storage.local.set({
				[core.SETTINGS_KEY]: core.createDefaultSettings(),
			});
		}
	}

	async function getSettings() {
		const stored = await chrome.storage.local.get(core.SETTINGS_KEY);
		return core.normalizeSettings(stored[core.SETTINGS_KEY]);
	}

	function save(settings) {
		return writeQueue.run(async () => {
			// 语言只由 SET_LANGUAGE_PAIR 写入，避免设置页的旧全量快照覆盖 Popup 新选择。
			const current = await getSettings();
			const updated = core.normalizeSettings({
				...settings,
				sourceMode: current.sourceMode,
				targetMode: current.targetMode,
			});
			await chrome.storage.local.set({ [core.SETTINGS_KEY]: updated });
			await notifyDebugSettings(updated);
			return updated;
		});
	}

	function updateDebugLogging(enabled) {
		return writeQueue.run(async () => {
			const settings = await getSettings();
			const updated = core.normalizeSettings({
				...settings,
				debugLogging: enabled,
				...(enabled ? {} : { debugRequestPayload: false }),
			});
			await chrome.storage.local.set({ [core.SETTINGS_KEY]: updated });
			await notifyDebugSettings(updated);
			return updated;
		});
	}

	function updateDebugRequestPayload(enabled) {
		return writeQueue.run(async () => {
			const settings = await getSettings();
			const updated = core.normalizeSettings({
				...settings,
				debugRequestPayload: enabled,
			});
			await chrome.storage.local.set({ [core.SETTINGS_KEY]: updated });
			await notifyDebugSettings(updated);
			return updated;
		});
	}

	function updateLanguagePair(sourceMode, targetMode) {
		return writeQueue.run(async () => {
			const settings = await getSettings();
			const updated = core.normalizeSettings({ ...settings, sourceMode, targetMode });
			if (updated.sourceMode !== sourceMode || updated.targetMode !== targetMode) {
				throw new Error("翻译语言组合无效");
			}
			await chrome.storage.local.set({ [core.SETTINGS_KEY]: updated });
			return updated;
		});
	}

	async function notifyDebugSettings(settings) {
		onDebugLoggingChanged(settings.debugLogging);
		await onDebugRequestPayloadChanged(settings.debugRequestPayload);
	}

	function assertProviderConfigured(settings) {
		const error = core.getProviderConfigurationError(settings);
		if (error) {
			throw new Error(error);
		}
	}

	async function assertProviderPermission(settings) {
		if (core.MODEL_PROVIDER_IDS.includes(settings.provider)) {
			const provider = providerCatalog.providers[settings.provider];
			if (!provider || !provider.models[settings[settings.provider].model]) {
				throw new Error("当前模型不在本地 allowlist 中");
			}
			return;
		}
		if (settings.provider === "custom") {
			await assertCustomHostPermission(settings.custom.baseUrl);
		}
	}

	async function assertCustomHostPermission(baseUrl) {
		const origin = core.getCustomApiOrigin(baseUrl);
		if (!origin) {
			throw new Error("自定义 Base URL 无效");
		}
		if (!chrome.permissions?.contains) {
			return;
		}
		const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
		if (!granted) {
			throw new Error("尚未授权访问该自定义 API 域名。请在设置页保存或测试时完成授权。");
		}
	}

	function isExtensionPageUrl(url) {
		return typeof url === "string" && url.startsWith(chrome.runtime.getURL(""));
	}

	function assertExtensionPage(sender) {
		if (!isExtensionPageUrl(sender.url)) {
			throw new Error("网页脚本无权读取敏感设置");
		}
	}

	return {
		assertExtensionPage,
		assertProviderConfigured,
		assertProviderPermission,
		ensureStoredSettings,
		getSettings,
		initialize,
		isExtensionPageUrl,
		save,
		updateDebugLogging,
		updateDebugRequestPayload,
		updateLanguagePair,
	};
}

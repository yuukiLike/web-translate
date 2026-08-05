import { computed, onBeforeUnmount, onMounted, reactive, ref, toRef, watch } from "vue";

import {
	PROVIDERS,
	TARGETS,
	createCatalogInfo,
	createFallbackSettings,
	createUsageRows,
	errorText,
	isRecord,
} from "./data.js";
import {
	createRuntimeMessenger,
	getCoreError,
	getManifestVersion,
} from "./optionsRuntime.js";
import { useDebug } from "./useDebug.js";

export function useOptions() {
	const core = globalThis.BilingualTranslatorCore;
	const catalog = globalThis.BilingualTranslatorProviderCatalog;
	const chromeApi = globalThis.chrome;
	const runtime = chromeApi?.runtime;
	const sendMessage = createRuntimeMessenger(runtime);
	const catalogInfo = createCatalogInfo(catalog);
	const ready = ref(false);
	const fatal = ref(catalogInfo.error || getCoreError(core));
	const version = ref(getManifestVersion(runtime));
	const status = reactive({ text: "", error: false });
	const busy = ref("");
	const connected = ref(false);
	const usage = ref({});
	const savedDebug = ref(false);
	let initialSettings = createFallbackSettings(catalog);

	if (!fatal.value) {
		try {
			initialSettings = core.normalizeSettings(core.createDefaultSettings());
		} catch (error) {
			fatal.value = errorText(error);
		}
	}
	if (!fatal.value && (!runtime || typeof runtime.sendMessage !== "function")) {
		fatal.value = "Chrome 扩展后台不可用。请重新加载扩展。";
	}

	const draft = reactive(initialSettings);
	const debug = useDebug({
		enabled: toRef(draft, "debugLogging"),
		saved: savedDebug,
		runtime,
		sendMessage,
	});
	const selectedProvider = computed(() => {
		return PROVIDERS.find((provider) => provider.id === draft.provider) || PROVIDERS[0];
	});
	const selectedTarget = computed(() => {
		return TARGETS.find((target) => target.id === draft.targetMode) || TARGETS[0];
	});
	const usageRows = computed(() => {
		if (fatal.value) {
			return [];
		}
		return createUsageRows(usage.value, core.getMonthKey(), getProviderName);
	});

	watch(
		() => {
			const providerSettings = draft[draft.provider];
			return [
				draft.provider,
				providerSettings?.apiKey,
				providerSettings?.baseUrl,
				providerSettings?.model,
				providerSettings?.region,
			];
		},
		() => {
			connected.value = false;
		},
	);

	function setStatus(text, error = false) {
		status.text = text;
		status.error = error;
	}

	function applySettings(value) {
		const settings = core.normalizeSettings(value);
		Object.assign(draft, settings);
		return settings;
	}

	function settingsForSave() {
		if (fatal.value) {
			throw new Error(fatal.value);
		}
		const settings = core.normalizeSettings(draft);
		const configurationError = core.getProviderConfigurationError(settings);
		if (configurationError) {
			throw new Error(configurationError);
		}
		return settings;
	}

	async function ensureCustomHostPermission(settings) {
		if (settings.provider !== "custom") {
			return;
		}
		const origin = core.getCustomApiOrigin(settings.custom.baseUrl);
		if (!origin) {
			throw new Error("自定义 Base URL 无效");
		}
		const permissions = chromeApi?.permissions;
		if (!permissions || typeof permissions.request !== "function") {
			return;
		}
		const origins = [`${origin}/*`];
		if (typeof permissions.contains === "function") {
			const alreadyGranted = await permissions.contains({ origins });
			if (alreadyGranted) {
				return;
			}
		}
		const granted = await permissions.request({ origins });
		if (!granted) {
			throw new Error("需要授权访问该自定义 API 域名");
		}
	}

	function acceptSavedSettings(value) {
		const settings = applySettings(value);
		savedDebug.value = settings.debugLogging;
		return settings;
	}

	function acceptUsage(value) {
		usage.value = isRecord(value) ? value : {};
	}

	function getProviderName(id) {
		try {
			return core.getProviderLabel(id, draft);
		} catch {
			return PROVIDERS.find((provider) => provider.id === id)?.name || id;
		}
	}

	async function load() {
		if (fatal.value) {
			ready.value = true;
			return;
		}
		try {
			const response = await sendMessage({ type: "GET_OPTIONS_STATE" });
			acceptSavedSettings(response.settings);
			acceptUsage(response.usage);
		} catch (error) {
			setStatus(errorText(error), true);
		} finally {
			ready.value = true;
		}
	}

	async function save() {
		busy.value = "save";
		setStatus("正在保存设置…");
		try {
			const settings = settingsForSave();
			await ensureCustomHostPermission(settings);
			const response = await sendMessage({ type: "SAVE_SETTINGS", settings });
			acceptSavedSettings(response.settings);
			setStatus("设置已保存");
			return true;
		} catch (error) {
			setStatus(errorText(error), true);
			return false;
		} finally {
			busy.value = "";
		}
	}

	async function saveDebug() {
		const requested = draft.debugLogging;
		busy.value = "debug";
		setStatus(requested ? "正在开启调试记录…" : "正在关闭调试记录…");
		try {
			const response = await sendMessage({ type: "SET_DEBUG_LOGGING", enabled: requested });
			const stored = response.debugLogging === true;
			savedDebug.value = stored;
			draft.debugLogging = stored;
			setStatus(stored ? "调试记录已开启" : "调试记录已关闭");
			return true;
		} catch (error) {
			draft.debugLogging = savedDebug.value;
			setStatus(errorText(error), true);
			return false;
		} finally {
			busy.value = "";
		}
	}

	async function testProvider() {
		busy.value = "test";
		connected.value = false;
		setStatus("正在测试连接…");
		try {
			const settings = settingsForSave();
			await ensureCustomHostPermission(settings);
			const saved = await sendMessage({ type: "SAVE_SETTINGS", settings });
			acceptSavedSettings(saved.settings);
			const tested = await sendMessage({ type: "TEST_PROVIDER" });
			const refreshed = await sendMessage({ type: "GET_OPTIONS_STATE" });
			acceptUsage(refreshed.usage);
			const message = typeof tested.message === "string" ? tested.message : "连接测试完成";
			setStatus(message);
			connected.value = true;
			return true;
		} catch (error) {
			setStatus(errorText(error), true);
			return false;
		} finally {
			busy.value = "";
		}
	}

	async function clearCache() {
		busy.value = "cache";
		setStatus("正在清理缓存…");
		try {
			const response = await sendMessage({ type: "CLEAR_CACHE" });
			const removed = typeof response.removed === "number" ? response.removed : 0;
			setStatus(`已删除 ${removed} 个缓存条目`);
			return true;
		} catch (error) {
			setStatus(errorText(error), true);
			return false;
		} finally {
			busy.value = "";
		}
	}

	function handleStorageChange(changes, areaName) {
		if (fatal.value || areaName !== "local" || !isRecord(changes)) {
			return;
		}
		const changedSettings = changes[core.SETTINGS_KEY];
		if (!isRecord(changedSettings) || !isRecord(changedSettings.newValue)) {
			return;
		}
		const settings = core.normalizeSettings(changedSettings.newValue);
		if (settings.debugLogging === savedDebug.value && draft.debugLogging === savedDebug.value) {
			return;
		}
		savedDebug.value = settings.debugLogging;
		draft.debugLogging = settings.debugLogging;
	}

	onMounted(() => {
		chromeApi?.storage?.onChanged?.addListener(handleStorageChange);
		void load();
	});

	onBeforeUnmount(() => {
		chromeApi?.storage?.onChanged?.removeListener(handleStorageChange);
	});

	return {
		draft,
		ready,
		fatal,
		version,
		providers: PROVIDERS,
		targets: TARGETS,
		catalogInfo,
		selectedProvider,
		selectedTarget,
		usageRows,
		status,
		busy,
		connected,
		save,
		saveDebug,
		testProvider,
		clearCache,
		debug,
	};
}

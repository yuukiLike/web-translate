import { computed, onBeforeUnmount, onMounted, reactive, ref, toRef, watch } from "vue";

import {
	PROVIDERS,
	SOURCES,
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
import { useDebugSettings } from "./useDebugSettings.js";

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
	const reloadRequired = ref(false);
	const usage = ref({});
	let languageRevision = 0;
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
	const debugSettings = useDebugSettings({ busy, draft, sendMessage, setStatus });
	const debug = useDebug({
		enabled: toRef(draft, "debugLogging"),
		saved: debugSettings.savedLogging,
		runtime,
		sendMessage,
	});
	const selectedProvider = computed(() => {
		return PROVIDERS.find((provider) => provider.id === draft.provider) || PROVIDERS[0];
	});
	const selectedSource = computed(() => {
		return SOURCES.find((source) => source.id === draft.sourceMode) || SOURCES[0];
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

	function setSourceMode(sourceMode) {
		if (!SOURCES.some((source) => source.id === sourceMode)) {
			return;
		}
		draft.sourceMode = sourceMode;
		if (sourceMode !== "auto" && sourceMode === draft.targetMode) {
			draft.targetMode = sourceMode === "zh" ? "en" : "zh";
		}
	}

	function setTargetMode(targetMode) {
		if (!TARGETS.some((target) => target.id === targetMode)) {
			return;
		}
		draft.targetMode = targetMode;
		if (draft.sourceMode === targetMode) {
			draft.sourceMode = targetMode === "zh" ? "en" : "zh";
		}
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
		debugSettings.accept(settings);
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
			const revisionAtStart = languageRevision;
			const response = await sendMessage({ type: "GET_OPTIONS_STATE" });
			const latestLanguage = {
				sourceMode: draft.sourceMode,
				targetMode: draft.targetMode,
			};
			acceptSavedSettings(response.settings);
			if (languageRevision !== revisionAtStart) Object.assign(draft, latestLanguage);
			acceptUsage(response.usage);
		} catch (error) {
			setStatus(errorText(error), true);
		} finally {
			ready.value = true;
		}
	}

	async function testProvider() {
		if (reloadRequired.value) {
			runtime.reload();
			return false;
		}
		busy.value = "test";
		connected.value = false;
		setStatus("正在测试连接…");
		try {
			const settings = settingsForSave();
			await ensureCustomHostPermission(settings);
			await sendMessage({
				type: "SET_LANGUAGE_PAIR",
				sourceMode: settings.sourceMode,
				targetLanguage: settings.targetMode,
			});
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
			const message = errorText(error);
			if (/未知消息类型|unknown message type/iu.test(message)) {
				reloadRequired.value = true;
				setStatus("后台版本未同步，请重新载入扩展后再次保存", true);
			} else setStatus(message, true);
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
		languageRevision += 1;
		draft.sourceMode = settings.sourceMode;
		draft.targetMode = settings.targetMode;
		debugSettings.sync(settings);
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
		sources: SOURCES,
		targets: TARGETS,
		catalogInfo,
		selectedProvider,
		selectedSource,
		selectedTarget,
		usageRows,
		status,
		busy,
		connected,
		reloadRequired,
		setSourceMode,
		setTargetMode,
		saveDebug: debugSettings.saveLogging,
		saveDebugRequestPayload: debugSettings.saveRequestPayload,
		testProvider,
		clearCache,
		debug,
	};
}

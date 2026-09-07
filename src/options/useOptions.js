import { computed, onBeforeUnmount, onMounted, reactive, ref, toRef, watch } from "vue";

import { changeSourceLanguage, changeTargetLanguage } from "../core/language-selection.js";
import { isRecord } from "../core/value-utils.js";
import { createCatalogInfo, createFallbackSettings } from "./catalogData.js";
import { errorText } from "./formatters.js";
import { PROVIDERS, SOURCES, TARGETS } from "./optionDefinitions.js";
import {
	createRuntimeMessenger,
	getCoreError,
	getManifestVersion,
} from "./optionsRuntime.js";
import { createProviderSetup } from "./providerSetup.js";
import { useDebug } from "./useDebug.js";
import { useDebugSettings } from "./useDebugSettings.js";
import { createUsageRows } from "./usageData.js";

export function useOptions() {
	const core = globalThis.BilingualTranslatorCore;
	const catalog = globalThis.BilingualTranslatorProviderCatalog;
	const chromeApi = globalThis.chrome;
	const runtime = chromeApi?.runtime;
	const sendMessage = createRuntimeMessenger(runtime);
	const providerSetup = createProviderSetup({ core, permissions: chromeApi?.permissions, sendMessage });
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
		captureEnabled: debugSettings.savedRequestPayload,
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

	function currentLanguagePair() {
		return { sourceMode: draft.sourceMode, targetLanguage: draft.targetMode };
	}

	function acceptLanguagePair(pair) {
		draft.sourceMode = pair.sourceMode;
		draft.targetMode = pair.targetLanguage;
	}

	function setSourceMode(sourceMode) {
		if (!SOURCES.some((source) => source.id === sourceMode)) {
			return;
		}
		acceptLanguagePair(changeSourceLanguage(currentLanguagePair(), sourceMode));
	}

	function setTargetMode(targetMode) {
		if (!TARGETS.some((target) => target.id === targetMode)) {
			return;
		}
		acceptLanguagePair(changeTargetLanguage(currentLanguagePair(), targetMode));
	}

	function acceptSavedSettings(value) {
		const settings = core.normalizeSettings(value);
		Object.assign(draft, settings);
		debugSettings.accept(settings);
		return settings;
	}

	function acceptUsage(value) {
		usage.value = isRecord(value) ? value : {};
	}

	function getProviderName(id) {
		try {
			return core.getProviderLabel(id);
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
			if (fatal.value) throw new Error(fatal.value);
			acceptSavedSettings(await providerSetup.saveSettings(draft));
			const tested = await providerSetup.testConnection();
			acceptUsage(tested.usage);
			setStatus(tested.message);
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

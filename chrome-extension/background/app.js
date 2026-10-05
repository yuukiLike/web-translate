import { createActionUi } from "./action-ui.js";
import { createBatchTranslator } from "./batch-translator.js";
import { createCacheStore } from "./cache-store.js";
import { createDebugMetadata } from "./debug-metadata.js";
import { createDebugStore } from "./debug-store.js";
import { createJsonClient } from "./json-client.js";
import { createMessageRouter } from "./message-router.js";
import { createProviderService } from "./provider-service.js";
import { createRunStore } from "./run-store.js";
import { createSettingsStore } from "./settings-store.js";
import { createStatusController } from "./status-controller.js";
import { createUsageStore } from "./usage-store.js";
import { getErrorMessage } from "./utilities.js";
import { createMessageValidators } from "./validation.js";
import { createModelTranslator } from "./providers/model-translator.js";
import { createRestTranslators } from "./providers/rest-translators.js";
import { createFrameRuns } from "./frame-runs.js";
import { createPageService } from "./page-service.js";
import { createSelectionService } from "./selection-service.js";
import { createSpeechService } from "./speech-service.js";

export function createBackgroundApp({ chrome, core, providerCatalog, providerRuntime }) {
	const extensionVersion = chrome.runtime.getManifest().version;
	const startup = Promise.withResolvers();
	void startup.promise.catch(() => {});
	const debugMetadata = createDebugMetadata({ core, providerCatalog, extensionVersion });
	const debug = createDebugStore({
		chrome,
		core,
		getSafeEndpoint: debugMetadata.getSafeEndpoint,
	});
	const settingsStore = createSettingsStore({
		chrome,
		core,
		providerCatalog,
		onDebugLoggingChanged: debug.setEnabled,
		onDebugRequestPayloadChanged: debug.setRequestPayloadEnabled,
	});
	const cacheStore = createCacheStore({ chrome, core });
	const usageStore = createUsageStore({ chrome, core });
	const runStore = createRunStore({ chrome, core });
	const validators = createMessageValidators(core);
	const frameRuns = createFrameRuns({ chrome, runStore });
	const speechService = createSpeechService({ chrome, settingsStore, validators });
	const pageService = createPageService({
		chrome, core, settingsStore,
		onNavigation: async (tabId, frameId) => {
			selectionService.removeTab(tabId, frameId === 0 ? null : frameId);
			await speechService.removeTab(tabId, frameId === 0 ? null : frameId);
			await frameRuns.removeFrame(tabId, frameId);
			if (frameId === 0) {
				statusController.removeTab(tabId);
				actionUi.removeTab(tabId);
			}
		},
	});
	const actionUi = createActionUi({
		chrome,
		extensionVersion,
		settingsStore,
		pageService,
	});
	const statusController = createStatusController({
		getCurrentRunId: runStore.getCurrentRunId,
		updateTabStatus: actionUi.updateTabStatus,
	});
	const jsonClient = createJsonClient({ debug });
	const modelTranslator = createModelTranslator({
		core,
		providerRuntime,
		debug,
		debugMetadata,
	});
	const restTranslators = createRestTranslators({ core, jsonClient, debugMetadata });
	const providerService = createProviderService({
		core,
		jsonClient,
		modelTranslator,
		restTranslators,
		debugMetadata,
		assertProviderConfigured: settingsStore.assertProviderConfigured,
		assertProviderPermission: settingsStore.assertProviderPermission,
	});
	const batchTranslator = createBatchTranslator({
		core,
		extensionVersion,
		cacheStore,
		usageStore,
		providerService,
		settingsStore,
		debug,
	});
	const selectionService = createSelectionService({ core, validators, settingsStore, cacheStore, batchTranslator });
	const messageRouter = createMessageRouter({
		chrome,
		core,
		providerCatalog,
		extensionVersion,
		ready: startup.promise,
		validators,
		settingsStore,
		actionUi,
		debug,
		debugMetadata,
		cacheStore,
		runStore,
		statusController,
		batchTranslator,
		providerService,
		pageService,
		frameRuns,
		selectionService,
		speechService,
	});

	async function start() {
		try {
			const settings = await settingsStore.initialize();
			await Promise.all([
				cacheStore.initialize(),
				debug.initialize(settings.debugLogging, settings.debugRequestPayload),
			]);
			startup.resolve();
			void cacheStore.queueMaintenance().catch(() => {});
			void actionUi.initialize(settings).catch(() => {});
		} catch (error) {
			startup.reject(error);
			throw error;
		}
	}

	function onInstalled(details) {
		void startup.promise
			.then(async () => {
				await settingsStore.ensureStoredSettings();
				if (details.reason === "install") {
					await chrome.runtime.openOptionsPage();
				}
			})
			.catch(() => {});
	}

	function onContextMenuClicked(info, tab) {
		void startup.promise.then(() => actionUi.handleMenuClick(info, tab)).catch(() => {});
	}

	function onMessage(message, sender, sendResponse) {
		if (["speech-offscreen", "speech-ui"].includes(message?.target)) return false;
		messageRouter.handleMessage(message, sender).then(
			(result) => sendResponse({ ok: true, ...result }),
			(error) => sendResponse({ ok: false, error: getErrorMessage(error) }),
		);
		return true;
	}

	function onConnect(port) {
		debug.connect(port, settingsStore.isExtensionPageUrl, startup.promise);
	}

	function onTabRemoved(tabId) {
		statusController.removeTab(tabId);
		actionUi.removeTab(tabId);
		selectionService.removeTab(tabId);
		void Promise.allSettled([frameRuns.removeTab(tabId), pageService.removeTab(tabId), speechService.removeTab(tabId)]);
	}

	function onNavigation(details) {
		void startup.promise.then(() => pageService.handleNavigation(details)).catch(() => {});
	}

	function onFrameReady(details) {
		void startup.promise.then(() => pageService.handleFrameReady(details)).catch(() => {});
	}

	function onCommand(command) {
		void startup.promise.then(async () => {
			const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
			if (command === "toggle-page") await actionUi.toggleTranslation(tab);
			else if (command === "translate-selection") await actionUi.handleMenuClick({ menuItemId: "translate-selection" }, tab);
		}).catch(() => {});
	}

	return {
		onConnect,
		onContextMenuClicked,
		onInstalled,
		onMessage,
		onTabRemoved,
		onNavigation,
		onFrameReady,
		onCommand,
		start,
	};
}

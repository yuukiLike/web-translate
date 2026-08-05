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

export function createBackgroundApp({ chrome, core, providerCatalog, providerRuntime }) {
	const extensionVersion = chrome.runtime.getManifest().version;
	const startup = createDeferred();
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
	});
	const cacheStore = createCacheStore({ chrome, core });
	const usageStore = createUsageStore({ chrome, core });
	const runStore = createRunStore({ chrome, core });
	const actionUi = createActionUi({
		chrome,
		extensionVersion,
		settingsStore,
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
	const messageRouter = createMessageRouter({
		chrome,
		core,
		providerCatalog,
		extensionVersion,
		ready: startup.promise,
		validators: createMessageValidators(core),
		settingsStore,
		actionUi,
		debug,
		debugMetadata,
		cacheStore,
		runStore,
		statusController,
		batchTranslator,
		providerService,
	});

	async function start() {
		try {
			const settings = await settingsStore.initialize();
			await Promise.all([
				cacheStore.initialize(),
				debug.initialize(settings.debugLogging),
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

	function onActionClicked(tab) {
		void startup.promise.then(() => actionUi.toggleTranslation(tab)).catch(() => {});
	}

	function onContextMenuClicked(info) {
		void startup.promise.then(() => actionUi.handleMenuClick(info)).catch(() => {});
	}

	function onMessage(message, sender, sendResponse) {
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
		void runStore.removeTab(tabId).catch(() => {});
	}

	return {
		onActionClicked,
		onConnect,
		onContextMenuClicked,
		onInstalled,
		onMessage,
		onTabRemoved,
		start,
	};
}

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	void promise.catch(() => {});
	return { promise, reject, resolve };
}

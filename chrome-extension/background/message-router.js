export function createMessageRouter({
	chrome,
	core,
	providerCatalog,
	extensionVersion,
	ready,
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
}) {
	async function handleMessage(message, sender) {
		await ready;
		if (!core.isRecord(message) || typeof message.type !== "string") {
			throw new Error("无效消息");
		}
		switch (message.type) {
			case "START_RUN":
				return await startRun(message, sender);
			case "GET_OPTIONS_STATE":
				return await getOptionsState(sender);
			case "SAVE_SETTINGS":
				return await saveSettings(message, sender);
			case "SET_DEBUG_LOGGING":
				return await setDebugLogging(message, sender);
			case "TEST_PROVIDER":
				return await testProvider(sender);
			case "GET_DEBUG_LOGS":
				return await getDebugLogs(sender);
			case "CLEAR_DEBUG_LOGS":
				return await clearDebugLogs(sender);
			case "CLEAR_CACHE":
				return await clearCache(sender);
			case "TRANSLATE_BATCH":
				return await translateBatch(message, sender);
			case "CANCEL_RUN":
				return await cancelRun(message, sender);
			case "STATUS":
				return await updateStatus(message, sender);
			case "OPEN_OPTIONS":
				await chrome.runtime.openOptionsPage();
				return {};
			default:
				throw new Error("未知消息类型");
		}
	}

	async function startRun(message, sender) {
		const tabId = getSenderTabId(sender);
		const runId = validators.validateRunId(message.runId);
		const startToken = runStore.beginStart(tabId, runId);
		try {
			statusController.invalidatePending(tabId);
			const settings = await settingsStore.getSettings();
			settingsStore.assertProviderConfigured(settings);
			await settingsStore.assertProviderPermission(settings);
			await runStore.saveSnapshot(
				tabId,
				runId,
				{
					settings,
					cacheGeneration: cacheStore.getGeneration(),
					cacheScope: getCacheScope(sender),
				},
				startToken,
			);
			runStore.confirmStart(tabId, runId, startToken);
			statusController.startRun(tabId, runId);
			debug.record({
				component: "background",
				eventType: "run.started",
				tabId,
				runId,
				provider: settings.provider,
				model: core.getProviderModel(settings),
				extensionVersion,
				catalogSourceSha: providerCatalog.source.commit,
				providerAdapter: debugMetadata.getProviderAdapter(settings),
				apiHost: debugMetadata.getProviderApiHost(settings),
				configuredConcurrency: Math.min(
					settings.concurrency,
					core.getProviderMaximumConcurrency(settings),
				),
				status: "started",
			});
			return { settings: core.publicSettings(settings) };
		} finally {
			runStore.finishStart(startToken);
		}
	}

	async function getOptionsState(sender) {
		settingsStore.assertExtensionPage(sender);
		const [settings, storedUsage] = await Promise.all([
			settingsStore.getSettings(),
			chrome.storage.local.get(core.USAGE_KEY),
		]);
		return { settings, usage: storedUsage[core.USAGE_KEY] ?? {} };
	}

	async function saveSettings(message, sender) {
		settingsStore.assertExtensionPage(sender);
		const settings = core.normalizeSettings(message.settings);
		await settingsStore.save(settings);
		await actionUi.updateState(settings);
		debug.record({
			component: "background",
			eventType: "settings.saved",
			provider: settings.provider,
			model: core.getProviderModel(settings),
			extensionVersion,
			catalogSourceSha: providerCatalog.source.commit,
			providerAdapter: debugMetadata.getProviderAdapter(settings),
			apiHost: debugMetadata.getProviderApiHost(settings),
			configuredConcurrency: Math.min(
				settings.concurrency,
				core.getProviderMaximumConcurrency(settings),
			),
			status: "completed",
		});
		return { settings };
	}

	async function setDebugLogging(message, sender) {
		settingsStore.assertExtensionPage(sender);
		if (typeof message.enabled !== "boolean") {
			throw new Error("调试开关无效");
		}
		const settings = await settingsStore.updateDebugLogging(message.enabled);
		await actionUi.updateState(settings);
		debug.record({
			component: "background",
			eventType: "debug.logging-enabled",
			extensionVersion,
			status: "completed",
		});
		return { debugLogging: settings.debugLogging };
	}

	async function testProvider(sender) {
		settingsStore.assertExtensionPage(sender);
		const settings = await settingsStore.getSettings();
		await settingsStore.assertProviderPermission(settings);
		return await providerService.test(settings);
	}

	async function getDebugLogs(sender) {
		settingsStore.assertExtensionPage(sender);
		return { events: await debug.getEvents() };
	}

	async function clearDebugLogs(sender) {
		settingsStore.assertExtensionPage(sender);
		await debug.clear();
		return {};
	}

	async function clearCache(sender) {
		settingsStore.assertExtensionPage(sender);
		return { removed: await cacheStore.clear() };
	}

	async function translateBatch(message, sender) {
		const tabId = getSenderTabId(sender);
		const request = validators.validateTranslationRequest(message);
		const snapshot = await runStore.getSnapshot(tabId, request.runId);
		const controller = runStore.registerController(tabId, request.runId);
		let batchState = {};
		try {
			batchState = runStore.nextBatch(tabId, request.runId);
			return await batchTranslator.translate(
				snapshot,
				request,
				tabId,
				!sender.tab.incognito,
				batchState,
				controller.signal,
			);
		} catch (error) {
			batchTranslator.recordFailure(snapshot, request, tabId, batchState, error);
			throw error;
		} finally {
			runStore.unregisterController(tabId, request.runId, controller);
		}
	}

	async function cancelRun(message, sender) {
		const tabId = getSenderTabId(sender);
		const runId = validators.validateRunId(message.runId);
		statusController.requestCancel(tabId, runId);
		const result = await runStore.cancel(tabId, runId);
		await statusController.cancelRun(tabId, runId, { force: result.cancelled });
		return {};
	}

	async function updateStatus(message, sender) {
		const tabId = getSenderTabId(sender);
		const runId = validators.validateRunId(message.runId);
		return await statusController.handleStatus(tabId, runId, message);
	}

	function getSenderTabId(sender) {
		if (!sender.tab?.id) {
			throw new Error("此请求必须来自网页");
		}
		return sender.tab.id;
	}

	function getCacheScope(sender) {
		try {
			const url = new URL(sender.tab?.url ?? sender.url);
			return url.origin === "null" ? `${url.protocol}//local-file` : url.origin;
		} catch {
			return "unknown-origin";
		}
	}

	return { handleMessage };
}

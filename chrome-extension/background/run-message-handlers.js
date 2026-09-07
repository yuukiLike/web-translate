export function createRunMessageHandlers({
	core,
	providerCatalog,
	extensionVersion,
	validators,
	settingsStore,
	debug,
	debugMetadata,
	cacheStore,
	runStore,
	statusController,
	batchTranslator,
}) {
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
				{ incognito: sender.tab.incognito === true },
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

	return { startRun, translateBatch, cancelRun, updateStatus };
}

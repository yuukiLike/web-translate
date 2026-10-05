import { canCaptureContent } from "./debug-content-policy.js";
import { createIdentifier } from "./utilities.js";

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
	frameRuns,
}) {
	async function startRun(message, sender) {
		const tabId = getSenderTabId(sender);
		const scope = frameRuns.scope(sender);
		const runId = validators.validateRunId(message.runId);
		const startToken = runStore.beginStart(scope, runId);
		try {
			if ((sender.frameId ?? 0) === 0) statusController.invalidatePending(tabId);
			const settings = await settingsStore.getSettings();
			settingsStore.assertProviderConfigured(settings);
			await settingsStore.assertProviderPermission(settings);
			await runStore.saveSnapshot(
				scope,
				runId,
				{
					settings,
					cacheGeneration: cacheStore.getGeneration(),
					cacheScope: getCacheScope(sender),
				},
				startToken,
			);
			runStore.confirmStart(scope, runId, startToken);
			if ((sender.frameId ?? 0) === 0) statusController.startRun(tabId, runId);
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
			return {
				settings: {
					...core.publicSettings(settings),
					captureContentTrace: (sender.frameId ?? 0) === 0 && canCaptureContent(settings, sender.tab.incognito === true),
				},
			};
		} finally {
			runStore.finishStart(startToken);
		}
	}

	async function translateBatch(message, sender) {
		const tabId = getSenderTabId(sender);
		const scope = frameRuns.scope(sender);
		const request = validators.validateTranslationRequest(message);
		const snapshot = await runStore.getSnapshot(scope, request.runId);
		const controller = runStore.registerController(scope, request.runId);
		let batchState = {};
		try {
			batchState = { ...runStore.nextBatch(scope, request.runId), batchId: createIdentifier() };
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
			runStore.unregisterController(scope, request.runId, controller);
		}
	}

	async function cancelRun(message, sender) {
		const tabId = getSenderTabId(sender);
		const scope = frameRuns.scope(sender);
		const runId = validators.validateRunId(message.runId);
		if ((sender.frameId ?? 0) === 0) statusController.requestCancel(tabId, runId);
		const result = await runStore.cancel(scope, runId);
		if ((sender.frameId ?? 0) === 0) await statusController.cancelRun(tabId, runId, { force: result.cancelled });
		return {};
	}

	async function updateStatus(message, sender) {
		const tabId = getSenderTabId(sender);
		const runId = validators.validateRunId(message.runId);
		if ((sender.frameId ?? 0) !== 0) return {};
		return await statusController.handleStatus(tabId, runId, message);
	}

	function getSenderTabId(sender) {
		if (!Number.isInteger(sender.tab?.id)) {
			throw new Error("此请求必须来自网页");
		}
		return sender.tab.id;
	}

	function getCacheScope(sender) {
		try {
			const url = new URL(sender.url ?? sender.tab?.url);
			return url.origin === "null" ? `${url.protocol}//local-file` : url.origin;
		} catch {
			return "unknown-origin";
		}
	}

	return { startRun, translateBatch, cancelRun, updateStatus };
}

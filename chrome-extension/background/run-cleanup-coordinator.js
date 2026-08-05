import { runKey } from "./utilities.js";

export function createRunCleanupCoordinator({ registry, pendingCancellations, currentRuns }) {
	function trackPersistence(tabId, runId, result) {
		registry.track(tabId, runId, result.snapshotCleanup);
		registry.trackTab(tabId, result.currentCleanup);
	}

	function releaseCancellationWhenCurrentSettles(tabId, runId, currentCleanup) {
		if (!currentCleanup) return;
		void currentCleanup.then(() => {
			pendingCancellations.delete(runKey(tabId, runId));
			if (currentRuns.get(tabId)?.runId === runId) currentRuns.delete(tabId);
		}, () => {});
	}

	async function canReleaseTab(result) {
		const [currentCleanup] = await Promise.allSettled(
			[result.currentCleanup].filter(Boolean),
		);
		await Promise.allSettled(
			[result.snapshotCleanup, result.tabCleanup].filter(Boolean),
		);
		return result.pointerInvalidated || currentCleanup?.status === "fulfilled";
	}

	return { canReleaseTab, releaseCancellationWhenCurrentSettles, trackPersistence };
}

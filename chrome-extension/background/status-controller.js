import { DONE_STATUS_STABILITY_MS } from "./constants.js";
import { runKey } from "./utilities.js";

export function createStatusController({
	getCurrentRunId,
	updateTabStatus,
	wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
	const currentRunIds = new Map();
	const cancelledRuns = new Set();
	const arrivalRevisions = new Map();
	const revisions = new Map();
	let arrivalSequence = 0;

	function startRun(tabId, runId) {
		invalidate(tabId);
		clearTabEntries(cancelledRuns, tabId);
		clearTabEntries(arrivalRevisions, tabId);
		currentRunIds.set(tabId, runId);
	}

	function invalidatePending(tabId) {
		invalidate(tabId);
	}

	function requestCancel(tabId, runId) {
		const key = runKey(tabId, runId);
		cancelledRuns.add(key);
		arrivalRevisions.delete(key);
		if (currentRunIds.get(tabId) === runId) {
			invalidate(tabId);
		}
	}

	function removeTab(tabId) {
		invalidate(tabId);
		currentRunIds.delete(tabId);
		clearTabEntries(cancelledRuns, tabId);
		clearTabEntries(arrivalRevisions, tabId);
		revisions.delete(tabId);
	}

	async function cancelRun(tabId, runId, { force = false } = {}) {
		const key = runKey(tabId, runId);
		if (!force && !(await isCurrentRun(tabId, runId, true))) {
			cancelledRuns.delete(key);
			return false;
		}
		if (force) {
			currentRunIds.set(tabId, runId);
		}
		cancelledRuns.add(key);
		arrivalRevisions.delete(key);
		const revision = invalidate(tabId);
		if (isCurrent(tabId, runId, revision)) {
			writeStatus(tabId, { state: "off" });
			currentRunIds.delete(tabId);
			return true;
		}
		return false;
	}

	async function handleStatus(tabId, runId, message) {
		const key = runKey(tabId, runId);
		const arrivalRevision = ++arrivalSequence;
		arrivalRevisions.set(key, arrivalRevision);
		if (cancelledRuns.has(key)) {
			releaseArrival(key, arrivalRevision);
			return { ignored: true };
		}
		if (!(await isCurrentRun(tabId, runId))) {
			releaseArrival(key, arrivalRevision);
			return { ignored: true };
		}
		if (!isLatestArrival(key, arrivalRevision) || cancelledRuns.has(key)) {
			return { ignored: true };
		}
		const revision = invalidate(tabId);
		if (message.state === "done") {
			await wait(DONE_STATUS_STABILITY_MS);
			if (
				!isLatestArrival(key, arrivalRevision) ||
				cancelledRuns.has(key) ||
				!isCurrent(tabId, runId, revision)
			) {
				return { ignored: true };
			}
		}
		if (message.state === "settling") {
			return {};
		}
		if (!isLatestArrival(key, arrivalRevision) || !isCurrent(tabId, runId, revision)) {
			return { ignored: true };
		}
		writeStatus(tabId, message);
		if (message.state === "off" && isCurrent(tabId, runId, revision)) {
			currentRunIds.delete(tabId);
		}
		return {};
	}

	async function isCurrentRun(tabId, runId, includeCancelled = false) {
		const currentRunId = currentRunIds.get(tabId);
		if (currentRunId) {
			return currentRunId === runId;
		}
		const persistedRunId = await getCurrentRunId(tabId, { includeCancelled });
		const newerCurrentRunId = currentRunIds.get(tabId);
		if (newerCurrentRunId) {
			return newerCurrentRunId === runId;
		}
		if (persistedRunId !== runId) {
			return false;
		}
		currentRunIds.set(tabId, runId);
		return true;
	}

	function invalidate(tabId) {
		const revision = (revisions.get(tabId) ?? 0) + 1;
		revisions.set(tabId, revision);
		return revision;
	}

	function isCurrent(tabId, runId, revision) {
		return currentRunIds.get(tabId) === runId && revisions.get(tabId) === revision;
	}

	function isLatestArrival(key, revision) {
		return arrivalRevisions.get(key) === revision;
	}

	function releaseArrival(key, revision) {
		if (isLatestArrival(key, revision)) arrivalRevisions.delete(key);
	}

	function writeStatus(tabId, message) {
		void Promise.resolve(updateTabStatus(tabId, message)).catch(() => {});
	}

	return {
		cancelRun,
		handleStatus,
		invalidatePending,
		removeTab,
		requestCancel,
		startRun,
	};
}

function clearTabEntries(collection, tabId) {
	const prefix = `${tabId}:`;
	for (const key of collection.keys()) {
		if (key.startsWith(prefix)) collection.delete(key);
	}
}

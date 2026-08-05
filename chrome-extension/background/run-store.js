import {
	createCurrentRun,
	createRunPersistence,
	isActiveCurrentRun,
} from "./run-persistence.js";
import { createRunActivityRegistry } from "./run-activity-registry.js";
import { createRunCleanupCoordinator } from "./run-cleanup-coordinator.js";
import { createRunCleanupRegistry } from "./run-cleanup-registry.js";
import { createRunStartRegistry } from "./run-start-registry.js";
import { createCancellationError, createInvalidRunError, selectCurrentRunId } from "./run-state.js";
import { createKeyedSerialTaskQueue, numberOrZero, runKey } from "./utilities.js";

export function createRunStore({ chrome, core }) {
	const persistence = createRunPersistence({ chrome });
	const activity = createRunActivityRegistry();
	const cleanups = createRunCleanupRegistry({
		deleteSnapshot: persistence.deleteSnapshot,
	});
	const currentRuns = new Map();
	const pendingCancellations = new Set();
	const cleanupCoordinator = createRunCleanupCoordinator({
		registry: cleanups,
		pendingCancellations,
		currentRuns,
	});
	const lifecycleTasks = createKeyedSerialTaskQueue();
	const removedTabs = new Set();
	const starts = createRunStartRegistry({ assertTabActive });

	function beginStart(tabId, runId) {
		cleanups.assertAvailable(tabId, runId);
		return starts.begin(tabId, runId);
	}

	async function saveSnapshot(tabId, runId, snapshot, startToken) {
		return lifecycleTasks.run(tabId, async () => {
			starts.assertPending(tabId, runId, startToken);
			const previousRun = await persistence.readCurrent(tabId);
			starts.assertPending(tabId, runId, startToken);
			if (previousRun?.runId === runId) throw new Error("相同翻译任务已存在");
			cleanups.assertAvailable(tabId, runId);
			await persistence.commit(tabId, runId, snapshot);
			try {
				starts.assertPending(tabId, runId, startToken);
			} catch (error) {
				await rollbackStart(tabId, runId, previousRun);
				throw error;
			}

			starts.markCommitted(startToken);
			activity.commit(tabId, runId, snapshot);
			currentRuns.set(tabId, createCurrentRun(runId));
			if (previousRun?.runId && previousRun.runId !== runId) {
				requestCancel(tabId, previousRun.runId);
				pendingCancellations.delete(runKey(tabId, previousRun.runId));
				discardSnapshot(tabId, previousRun.runId);
			}
		});
	}

	function confirmStart(tabId, runId, startToken) {
		starts.assertUsable(tabId, runId, startToken);
		assertCurrentRun(tabId, runId);
	}

	async function getCurrentRunId(tabId, { includeCancelled = false } = {}) {
		if (removedTabs.has(tabId)) {
			return "";
		}
		const memoryRun = currentRuns.get(tabId);
		if (memoryRun) {
			return selectCurrentRunId(memoryRun, includeCancelled);
		}

		const storedRun = await persistence.readCurrent(tabId);
		if (removedTabs.has(tabId)) {
			return "";
		}
		const newerMemoryRun = currentRuns.get(tabId);
		if (newerMemoryRun) {
			return selectCurrentRunId(newerMemoryRun, includeCancelled);
		}
		if (!storedRun) {
			return "";
		}
		const effectiveRun = pendingCancellations.has(runKey(tabId, storedRun.runId))
			? createCurrentRun(storedRun.runId, "cancelled")
			: storedRun;
		currentRuns.set(tabId, effectiveRun);
		return selectCurrentRunId(effectiveRun, includeCancelled);
	}

	async function getSnapshot(tabId, runId) {
		assertRunActive(tabId, runId);
		if ((await getCurrentRunId(tabId)) !== runId) {
			throw createInvalidRunError();
		}
		assertRunActive(tabId, runId);
		const memorySnapshot = activity.getSnapshot(tabId, runId);
		if (memorySnapshot) {
			return memorySnapshot;
		}
		const snapshot = await persistence.readSnapshot(tabId, runId);
		assertRunActive(tabId, runId);
		if ((await getCurrentRunId(tabId)) !== runId) {
			throw createInvalidRunError();
		}
		if (!isValidSnapshot(snapshot)) {
			throw createInvalidRunError();
		}
		const normalizedSnapshot = {
			...snapshot,
			settings: core.normalizeSettings(snapshot.settings),
			cacheGeneration: numberOrZero(snapshot.cacheGeneration),
		};
		activity.rememberSnapshot(tabId, runId, normalizedSnapshot);
		return normalizedSnapshot;
	}

	function nextBatch(tabId, runId) {
		assertRunActive(tabId, runId);
		assertCurrentRun(tabId, runId);
		return activity.nextBatch(tabId, runId);
	}

	function registerController(tabId, runId) {
		assertRunActive(tabId, runId);
		assertCurrentRun(tabId, runId);
		return activity.registerController(tabId, runId);
	}

	function unregisterController(tabId, runId, controller) {
		activity.unregisterController(tabId, runId, controller);
	}

	function requestCancel(tabId, runId) {
		const key = runKey(tabId, runId);
		starts.cancel(tabId, runId);
		const currentRun = currentRuns.get(tabId);
		if (currentRun?.runId === runId) {
			currentRuns.set(tabId, createCurrentRun(runId, "cancelled"));
		} else {
			pendingCancellations.add(key);
		}
		activity.cancel(tabId, runId);
	}

	function cancel(tabId, runId) {
		requestCancel(tabId, runId);
		return lifecycleTasks.run(tabId, async () => {
			const result = await persistence.invalidateRun(tabId, runId);
			cleanupCoordinator.trackPersistence(tabId, runId, result);
			if (result.pointerInvalidated) {
				reconcileCurrentRun(tabId, runId, result);
				pendingCancellations.delete(runKey(tabId, runId));
			} else {
				cleanupCoordinator.releaseCancellationWhenCurrentSettles(
					tabId,
					runId,
					result.currentCleanup,
				);
			}
			// 持久指针或当前 Worker 屏障已失效；快照回收不阻塞停止。
			discardSnapshot(tabId, runId);
			return { cancelled: result.matched };
		});
	}

	function removeTab(tabId) {
		removedTabs.add(tabId);
		starts.cancelTab(tabId);
		clearTabMemory(tabId);
		const task = lifecycleTasks.run(tabId, () => persistence.closeTab(tabId));
		void task.then(async (result) => {
			if (await cleanupCoordinator.canReleaseTab(result)) {
				removedTabs.delete(tabId);
			}
		}, () => {});
		return task;
	}

	function assertRunActive(tabId, runId) {
		assertTabActive(tabId);
		const currentRun = currentRuns.get(tabId);
		if (
			pendingCancellations.has(runKey(tabId, runId)) ||
			(currentRun?.runId === runId && !isActiveCurrentRun(currentRun))
		) {
			throw createCancellationError();
		}
	}

	function assertCurrentRun(tabId, runId) {
		const currentRun = currentRuns.get(tabId);
		if (currentRun?.runId !== runId || !isActiveCurrentRun(currentRun)) {
			throw createInvalidRunError();
		}
	}

	function assertTabActive(tabId) {
		if (removedTabs.has(tabId)) {
			throw new Error("标签页已关闭");
		}
	}

	function isValidSnapshot(snapshot) {
		return (
			core.isRecord(snapshot) &&
			core.isRecord(snapshot.settings) &&
			typeof snapshot.cacheScope === "string"
		);
	}

	return {
		beginStart,
		cancel,
		confirmStart,
		finishStart: starts.finish,
		getCurrentRunId,
		getSnapshot,
		nextBatch,
		registerController,
		removeTab,
		requestCancel,
		saveSnapshot,
		unregisterController,
	};

	async function rollbackStart(tabId, runId, previousRun) {
		const key = runKey(tabId, runId);
		pendingCancellations.add(key);
		let cancellationError;
		try {
			const result = await persistence.invalidateRun(tabId, runId);
			cleanupCoordinator.trackPersistence(tabId, runId, result);
			if (result.currentCleanup) await Promise.allSettled([result.currentCleanup]);
			if (result.pointerInvalidated) reconcileCurrentRun(tabId, runId, result);
		} catch (error) {
			cancellationError = error;
		}
		try {
			await persistence.restoreCurrent(tabId, previousRun);
			restoreMemoryCurrent(tabId, previousRun);
			pendingCancellations.delete(key);
		} catch (restoreError) {
			if (cancellationError) {
				throw new AggregateError(
					[cancellationError, restoreError],
					"无法安全回滚翻译任务",
				);
			}
			throw restoreError;
		} finally {
			discardSnapshot(tabId, runId);
		}
	}

	function discardSnapshot(tabId, runId) {
		cleanups.discard(tabId, runId);
	}

	function reconcileCurrentRun(tabId, runId, result) {
		if (result.matched) {
			currentRuns.set(tabId, result.currentRun);
			return;
		}
		if (currentRuns.get(tabId)?.runId !== runId) {
			return;
		}
		if (result.currentRun) {
			currentRuns.set(tabId, result.currentRun);
		} else {
			currentRuns.delete(tabId);
		}
	}

	function restoreMemoryCurrent(tabId, previousRun) {
		if (!previousRun) {
			currentRuns.delete(tabId);
			return;
		}
		const key = runKey(tabId, previousRun.runId);
		currentRuns.set(
			tabId,
			pendingCancellations.has(key)
				? createCurrentRun(previousRun.runId, "cancelled")
				: previousRun,
		);
	}

	function clearTabMemory(tabId) {
		const prefix = `${tabId}:`;
		activity.removeTab(tabId);
		for (const key of pendingCancellations) {
			if (key.startsWith(prefix)) pendingCancellations.delete(key);
		}
		currentRuns.delete(tabId);
	}
}

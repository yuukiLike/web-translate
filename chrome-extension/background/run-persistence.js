import { STORAGE_KEYS } from "./constants.js";
import { runKey } from "./utilities.js";

const ACTIVE_STATE = "active";
const CANCELLED_STATE = "cancelled";

export function createRunPersistence({ chrome }) {
	function snapshotKey(tabId, runId) {
		return `${STORAGE_KEYS.runSnapshotPrefix}${runKey(tabId, runId)}`;
	}

	function currentKey(tabId) {
		return `${STORAGE_KEYS.currentRunPrefix}${tabId}`;
	}

	async function readCurrent(tabId) {
		const key = currentKey(tabId);
		const stored = await chrome.storage.session.get(key);
		return normalizeCurrentRun(stored[key]);
	}

	async function commit(tabId, runId, snapshot) {
		await chrome.storage.session.set({
			[snapshotKey(tabId, runId)]: snapshot,
			[currentKey(tabId)]: createCurrentRun(runId, ACTIVE_STATE),
		});
	}

	async function restoreCurrent(tabId, currentRun) {
		const key = currentKey(tabId);
		if (currentRun) {
			await chrome.storage.session.set({ [key]: currentRun });
			return;
		}
		await chrome.storage.session.remove(key);
	}

	async function invalidateRun(tabId, runId) {
		let currentRun;
		try {
			currentRun = await readCurrent(tabId);
		} catch (readError) {
			const snapshotCleanup = createCleanupOperation("snapshot", () =>
				deleteSnapshot(tabId, runId),
			);
			await firstSuccessfulCleanup(
				readError,
				[snapshotCleanup],
				"无法读取或清理已取消任务",
			);
			return {
				matched: true,
				currentRun: null,
				pointerInvalidated: false,
				snapshotCleanup: snapshotCleanup.task,
			};
		}
		if (currentRun?.runId !== runId) {
			return { matched: false, currentRun, pointerInvalidated: true };
		}
		const cancelledRun = createCurrentRun(runId, CANCELLED_STATE);
		try {
			await chrome.storage.session.set({ [currentKey(tabId)]: cancelledRun });
			return { matched: true, currentRun: cancelledRun, pointerInvalidated: true };
		} catch (markerError) {
			const currentCleanup = createCleanupOperation("current", () =>
				chrome.storage.session.remove(currentKey(tabId)),
			);
			const snapshotCleanup = createCleanupOperation("snapshot", () =>
				deleteSnapshot(tabId, runId),
			);
			const cleanupKind = await firstSuccessfulCleanup(
				markerError,
				[currentCleanup, snapshotCleanup],
				"无法持久化或清理已取消任务",
			);
			return {
				matched: true,
				currentRun: null,
				currentCleanup: currentCleanup.task,
				pointerInvalidated: cleanupKind === "current",
				snapshotCleanup: snapshotCleanup.task,
			};
		}
	}

	async function markCurrentCancelled(tabId) {
		const currentRun = await readCurrent(tabId);
		if (!currentRun) {
			return null;
		}
		const cancelledRun = createCurrentRun(currentRun.runId, CANCELLED_STATE);
		await chrome.storage.session.set({ [currentKey(tabId)]: cancelledRun });
		return cancelledRun;
	}

	async function readSnapshot(tabId, runId) {
		const key = snapshotKey(tabId, runId);
		const stored = await chrome.storage.session.get(key);
		return stored[key];
	}

	async function deleteSnapshot(tabId, runId) {
		await chrome.storage.session.remove(snapshotKey(tabId, runId));
	}

	async function deleteTab(tabId) {
		await deleteTabSnapshots(tabId);
		await chrome.storage.session.remove(currentKey(tabId));
	}

	async function closeTab(tabId) {
		let cancelledRun;
		try {
			cancelledRun = await markCurrentCancelled(tabId);
		} catch (markerError) {
			const currentCleanup = createCleanupOperation("current", () =>
				chrome.storage.session.remove(currentKey(tabId)),
			);
			const snapshotCleanup = createCleanupOperation("snapshot", () =>
				deleteTabSnapshots(tabId),
			);
			const cleanupKind = await firstSuccessfulCleanup(
				markerError,
				[currentCleanup, snapshotCleanup],
				"无法持久化或清理已关闭标签页",
			);
			return {
				currentCleanup: currentCleanup.task,
				pointerInvalidated: cleanupKind === "current",
				snapshotCleanup: snapshotCleanup.task,
			};
		}
		if (!cancelledRun) {
			const tabCleanup = deleteTab(tabId);
			void tabCleanup.catch(() => {});
			return { pointerInvalidated: true, tabCleanup };
		}
		try {
			await deleteTab(tabId);
		} catch {
			// cancelled 指针已经落盘；清理失败也不能恢复该标签页的任务。
		}
		return { pointerInvalidated: true };
	}

	async function deleteTabSnapshots(tabId) {
		const stored = await chrome.storage.session.get(null);
		const prefix = `${STORAGE_KEYS.runSnapshotPrefix}${tabId}:`;
		const snapshotKeys = Object.keys(stored).filter((key) => key.startsWith(prefix));
		if (snapshotKeys.length > 0) {
			await chrome.storage.session.remove(snapshotKeys);
		}
	}

	return {
		closeTab,
		commit,
		deleteSnapshot,
		invalidateRun,
		readCurrent,
		readSnapshot,
		restoreCurrent,
	};
}

async function firstSuccessfulCleanup(primaryError, operations, message) {
	try {
		return await Promise.any(
			operations.map(async (operation) => {
				await operation.task;
				return operation.kind;
			}),
		);
	} catch (cleanupError) {
		throw new AggregateError(
			[primaryError, ...(cleanupError.errors ?? [cleanupError])],
			message,
		);
	}
}

function createCleanupOperation(kind, run) {
	return { kind, task: Promise.resolve().then(run) };
}

export function createCurrentRun(runId, state = ACTIVE_STATE) {
	return { runId, state };
}

export function normalizeCurrentRun(value) {
	if (typeof value === "string" && value) {
		return createCurrentRun(value);
	}
	if (
		value &&
		typeof value === "object" &&
		typeof value.runId === "string" &&
		value.runId &&
		[ACTIVE_STATE, CANCELLED_STATE].includes(value.state)
	) {
		return createCurrentRun(value.runId, value.state);
	}
	return null;
}

export function isActiveCurrentRun(currentRun) {
	return currentRun?.state === ACTIVE_STATE;
}

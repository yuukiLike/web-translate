import { runKey } from "./utilities.js";

export function createRunActivityRegistry() {
	const controllersByRun = new Map();
	const snapshots = new Map();
	const batchSequences = new Map();

	function commit(tabId, runId, snapshot) {
		const key = runKey(tabId, runId);
		snapshots.set(key, snapshot);
		batchSequences.set(key, 0);
	}

	function rememberSnapshot(tabId, runId, snapshot) {
		snapshots.set(runKey(tabId, runId), snapshot);
	}

	function getSnapshot(tabId, runId) {
		return snapshots.get(runKey(tabId, runId));
	}

	function nextBatch(tabId, runId) {
		const key = runKey(tabId, runId);
		const batchIndex = (batchSequences.get(key) ?? 0) + 1;
		batchSequences.set(key, batchIndex);
		return {
			batchIndex,
			queueDepth: controllersByRun.get(key)?.size ?? 1,
		};
	}

	function registerController(tabId, runId) {
		const key = runKey(tabId, runId);
		const controller = new AbortController();
		const controllers = controllersByRun.get(key) ?? new Set();
		controllers.add(controller);
		controllersByRun.set(key, controllers);
		return controller;
	}

	function unregisterController(tabId, runId, controller) {
		const key = runKey(tabId, runId);
		const controllers = controllersByRun.get(key);
		controllers?.delete(controller);
		if (controllers?.size === 0) {
			controllersByRun.delete(key);
		}
	}

	function cancel(tabId, runId) {
		const key = runKey(tabId, runId);
		for (const controller of controllersByRun.get(key) ?? []) {
			controller.abort(new Error("翻译已取消"));
		}
		controllersByRun.delete(key);
		snapshots.delete(key);
		batchSequences.delete(key);
	}

	function removeTab(tabId) {
		const prefix = `${tabId}:`;
		for (const [key, controllers] of controllersByRun) {
			if (!key.startsWith(prefix)) continue;
			for (const controller of controllers) {
				controller.abort(new Error("翻译已取消"));
			}
			controllersByRun.delete(key);
		}
		for (const collection of [snapshots, batchSequences]) {
			for (const key of collection.keys()) {
				if (key.startsWith(prefix)) collection.delete(key);
			}
		}
	}

	return {
		cancel,
		commit,
		getSnapshot,
		nextBatch,
		registerController,
		rememberSnapshot,
		removeTab,
		unregisterController,
	};
}

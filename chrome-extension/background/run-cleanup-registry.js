import { runKey } from "./utilities.js";

export function createRunCleanupRegistry({ deleteSnapshot }) {
	const tasksByRun = new Map();
	const tasksByTab = new Map();

	function assertAvailable(tabId, runId) {
		if (tasksByTab.has(tabId)) {
			throw new Error("标签页任务仍在清理，请重试");
		}
		if (tasksByRun.has(runKey(tabId, runId))) {
			throw new Error("相同翻译任务仍在清理，请重试");
		}
	}

	function discard(tabId, runId) {
		const task = Promise.resolve().then(() => deleteSnapshot(tabId, runId));
		return track(tabId, runId, task);
	}

	function track(tabId, runId, task) {
		return trackTask(tasksByRun, runKey(tabId, runId), task);
	}

	function trackTab(tabId, task) {
		return trackTask(tasksByTab, tabId, task);
	}

	function trackTask(collection, key, task) {
		if (!task) return null;
		const tasks = collection.get(key) ?? new Set();
		tasks.add(task);
		collection.set(key, tasks);
		const cleanup = () => {
			tasks.delete(task);
			if (tasks.size === 0) {
				collection.delete(key);
			}
		};
		void task.then(cleanup, cleanup);
		return task;
	}

	return { assertAvailable, discard, track, trackTab };
}

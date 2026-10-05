import { STORAGE_KEYS } from "./constants.js";

/** iframe 拥有独立的运行指针，不能覆盖主框架正在翻译的任务。 */
export function createFrameRuns({ chrome, runStore }) {
	const scopesByTab = new Map();

	function scope(sender) {
		const tabId = sender.tab?.id;
		const frameId = sender.frameId ?? 0;
		if (!Number.isInteger(tabId) || !Number.isInteger(frameId) || frameId < 0) {
			throw new Error("此请求必须来自网页");
		}
		const key = frameId === 0 ? tabId : `${tabId}/frame/${frameId}`;
		const scopes = scopesByTab.get(tabId) ?? new Set();
		scopes.add(key);
		scopesByTab.set(tabId, scopes);
		return key;
	}

	async function removeTab(tabId) {
		const scopes = scopesByTab.get(tabId) ?? new Set([tabId]);
		scopesByTab.delete(tabId);
		const cleanup = Promise.allSettled([...scopes].map((key) => runStore.removeTab(key)));
		const tasks = [];
		// Worker 重启后也清理 session 中保留的子框架任务。
		const stored = await chrome.storage.session.get(null).catch(() => ({}));
		const prefix = `${STORAGE_KEYS.currentRunPrefix}${tabId}/frame/`;
		for (const key of Object.keys(stored)) {
			if (!key.startsWith(prefix)) continue;
			const frameScope = key.slice(STORAGE_KEYS.currentRunPrefix.length);
			if (!scopes.has(frameScope)) tasks.push(runStore.removeTab(frameScope));
		}
		await cleanup;
		await Promise.allSettled(tasks);
	}

	async function removeFrame(tabId, frameId) {
		if (frameId === 0) return removeTab(tabId);
		const key = `${tabId}/frame/${frameId}`;
		scopesByTab.get(tabId)?.delete(key);
		await runStore.removeTab(key);
	}

	return { scope, removeTab, removeFrame };
}

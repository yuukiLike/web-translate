import { runKey } from "./utilities.js";

export function createRunStartRegistry({ assertTabActive }) {
	const startsByRun = new Map();
	const latestByTab = new Map();

	function begin(tabId, runId) {
		assertTabActive(tabId);
		const previousStart = latestByTab.get(tabId);
		if (previousStart && !previousStart.committed) {
			previousStart.replaced = true;
		}
		const token = {
			tabId,
			runId,
			cancelled: false,
			committed: false,
			finished: false,
			replaced: false,
		};
		latestByTab.set(tabId, token);
		const key = runKey(tabId, runId);
		const tokens = startsByRun.get(key) ?? new Set();
		tokens.add(token);
		startsByRun.set(key, tokens);
		return token;
	}

	function finish(token) {
		if (!token || token.finished) {
			return;
		}
		token.finished = true;
		const key = runKey(token.tabId, token.runId);
		const tokens = startsByRun.get(key);
		tokens?.delete(token);
		if (tokens?.size === 0) {
			startsByRun.delete(key);
		}
		if (latestByTab.get(token.tabId) === token) {
			latestByTab.delete(token.tabId);
		}
	}

	function cancel(tabId, runId) {
		for (const token of startsByRun.get(runKey(tabId, runId)) ?? []) {
			token.cancelled = true;
		}
	}

	function cancelTab(tabId) {
		for (const tokens of startsByRun.values()) {
			for (const token of tokens) {
				if (token.tabId === tabId) {
					token.cancelled = true;
				}
			}
		}
		latestByTab.delete(tabId);
	}

	function assertPending(tabId, runId, token) {
		assertUsable(tabId, runId, token);
		if (token.committed || latestByTab.get(tabId) !== token) {
			throw createReplacementError();
		}
	}

	function assertUsable(tabId, runId, token) {
		assertTabActive(tabId);
		if (!token || token.tabId !== tabId || token.runId !== runId || token.finished) {
			throw new Error("翻译任务已失效，请重新点击扩展图标");
		}
		if (token.cancelled) {
			throw new Error("翻译已取消");
		}
		if (token.replaced) {
			throw createReplacementError();
		}
	}

	function markCommitted(token) {
		token.committed = true;
	}

	return { assertPending, assertUsable, begin, cancel, cancelTab, finish, markCommitted };
}

function createReplacementError() {
	return new Error("翻译启动已被较新的任务取代");
}

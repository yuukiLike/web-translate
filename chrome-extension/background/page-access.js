const SESSION_PREFIX = "reading-page:";

/** 授权绑定浏览器的 documentId；同一个标签导航后不能继承旧文档的读取授权。 */
export function createPageAccess({ chrome, core }) {
	const { getPageAccessError, getPageOrigin } = core;
	async function getSession(tabId) {
		const key = `${SESSION_PREFIX}${tabId}`;
		return (await chrome.storage.session.get(key))[key];
	}

	async function saveSession(tabId, state) {
		await chrome.storage.session.set({ [`${SESSION_PREFIX}${tabId}`]: state });
	}

	async function removeSession(tabId) {
		await chrome.storage.session.remove(`${SESSION_PREFIX}${tabId}`);
	}

	async function listSessions() {
		const stored = await chrome.storage.session.get(null);
		return Object.entries(stored).filter(([key]) => key.startsWith(SESSION_PREFIX))
			.map(([key, state]) => ({ tabId: Number(key.slice(SESSION_PREFIX.length)), state }));
	}

	async function getFrames(tabId) {
		const frames = await chrome.webNavigation.getAllFrames({ tabId });
		const main = frames?.find((frame) => frame.frameId === 0);
		const error = getPageAccessError(main?.url);
		if (error) throw new Error(error);
		const origin = getPageOrigin(main.url);
		const allowed = frames.filter((frame) => typeof frame.documentId === "string" && frame.documentId &&
			frame.documentLifecycle === "active" && getPageOrigin(frame.url) === origin);
		if (!allowed.includes(main)) throw new Error("网页已切换，请重新启用翻译");
		return [main, ...allowed.filter((frame) => frame.frameId !== 0)];
	}

	function createSession(state, frames) {
		return {
			active: state.active === true,
			selectionActive: state.selectionActive === true,
			origin: getPageOrigin(frames[0].url),
			documents: frames.map(({ frameId, documentId }) => ({ frameId, documentId })),
		};
	}

	async function assertSender(sender, capability) {
		const error = getPageAccessError(sender.url);
		if (error) throw new Error(error);
		if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) ||
			!Number.isInteger(sender.frameId) || sender.frameId < 0 || !sender.documentId ||
			sender.documentLifecycle !== "active" || sender.origin !== getPageOrigin(sender.url)) {
			throw new Error("无法确认请求的网页身份");
		}
		const frames = await getFrames(sender.tab.id);
		// 浏览器查询可能排队，必须在查询之后读取最新授权，避免关闭后的请求继续发送。
		const session = await getSession(sender.tab.id);
		if (!session?.[capability] || session.origin !== getPageOrigin(sender.url) ||
			session.origin !== getPageOrigin(sender.tab.url) ||
			!session.documents?.some((frame) => frame.frameId === sender.frameId && frame.documentId === sender.documentId)) {
			throw new Error("请先在当前网页主动启用翻译或划词");
		}
		const main = session.documents.find((frame) => frame.frameId === 0);
		if (frames[0].documentId !== main?.documentId ||
			!frames.some((frame) => frame.frameId === sender.frameId && frame.documentId === sender.documentId)) {
			throw new Error("网页已切换，请重新启用翻译");
		}
	}

	return { getSession, saveSession, removeSession, listSessions, getFrames, createSession, assertSender };
}

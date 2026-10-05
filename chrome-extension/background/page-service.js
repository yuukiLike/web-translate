import { createKeyedSerialTaskQueue } from "./utilities.js";

const SESSION_PREFIX = "reading-page:";

/** 所有页面入口复用同一套注入；访问不了的子框架不会阻断正文。 */
export function createPageService({ chrome, core, settingsStore, onNavigation }) {
	const commands = createKeyedSerialTaskQueue();

	async function getSession(tabId) {
		const key = `${SESSION_PREFIX}${tabId}`;
		return (await chrome.storage.session.get(key))[key];
	}

	async function saveSession(tabId, state) {
		await chrome.storage.session.set({ [`${SESSION_PREFIX}${tabId}`]: state });
	}

	async function getState(tabId) {
		try {
			return await chrome.tabs.sendMessage(tabId, { type: "BT_GET_PAGE_STATE" }, { frameId: 0 }) ?? { active: false, selectionActive: false };
		} catch {
			return { active: false, selectionActive: false };
		}
	}

	async function inject(tabId, frameId) {
		const target = { tabId, frameIds: [frameId] };
		const installed = await chrome.scripting.executeScript({
			target,
			func: () => Boolean(globalThis.__bilingualWebTranslatorController),
		});
		if (installed[0]?.result) return;
		await chrome.scripting.insertCSS({ target, files: ["content/content.css"] });
		await chrome.scripting.executeScript({
			target,
			files: ["generated/provider-catalog.js", "generated/core.js", "generated/content-script.js"],
		});
	}

	async function sendCommand(tabId, frameId, command) {
		await inject(tabId, frameId);
		const response = await chrome.tabs.sendMessage(tabId, { type: "BT_PAGE_COMMAND", ...command }, { frameId });
		if (!response?.ok) throw new Error(response?.error || "页面翻译模块没有响应，请刷新网页");
		return response;
	}

	async function getFrames(tabId) {
		const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
		return [...new Set([0, ...(frames ?? []).map((frame) => frame.frameId)])];
	}

	async function synchronize(tabId, state, settings) {
		const command = { command: "sync", ...state, settings: core.publicSettings(settings) };
		// 主框架必须成功；对子框架逐个尝试，保留实际可访问的列表。
		await sendCommand(tabId, 0, command);
		const frames = (await getFrames(tabId)).filter((frameId) => frameId !== 0);
		const outcomes = await Promise.allSettled(frames.map((frameId) => sendCommand(tabId, frameId, command)));
		const injectedFrames = [0];
		outcomes.forEach((outcome, index) => {
			if (outcome.status === "fulfilled") injectedFrames.push(frames[index]);
		});
		await saveSession(tabId, { ...state, frames: injectedFrames });
		return { status: "triggered", ...state, skippedFrames: frames.length + 1 - injectedFrames.length };
	}

	function toggle(tab) {
		return commands.run(tab.id, async () => {
			const state = await getState(tab.id);
			const settings = await settingsStore.getSettings();
			if (!state.active) {
				try {
					settingsStore.assertProviderConfigured(settings);
					await settingsStore.assertProviderPermission(settings);
				} catch (error) {
					error.requiresSettings = true;
					throw error;
				}
			}
			return synchronize(tab.id, {
				active: !state.active,
				selectionActive: state.selectionActive || (!state.active && settings.reading.selectionEnabled),
			}, settings);
		});
	}

	function toggleSelection(tab) {
		return commands.run(tab.id, async () => {
			const state = await getState(tab.id);
			const settings = await settingsStore.getSettings();
			return synchronize(tab.id, { active: state.active, selectionActive: !state.selectionActive }, settings);
		});
	}

	function selection(tab, text, frameId = 0, speakOnly = false) {
		return commands.run(tab.id, async () => {
			if (!text) {
				const selected = await findSelection(tab.id);
				if (!selected) throw new Error("请先选择需要翻译的文字");
				text = selected.text;
				frameId = selected.frameId;
			}
			const settings = await settingsStore.getSettings();
			const previous = await getState(tab.id);
			if (frameId !== 0) await sendCommand(tab.id, 0, {
				command: "sync", active: previous.active, selectionActive: true, settings: core.publicSettings(settings),
			});
			await sendCommand(tab.id, frameId, {
				command: "selection",
				settings: core.publicSettings(settings),
				text,
				speakOnly,
			});
			const state = await getState(tab.id);
			const session = await getSession(tab.id);
			await saveSession(tab.id, {
				...state,
				selectionActive: true,
				frames: [...new Set([...(session?.frames ?? [0]), frameId])],
			});
			return { status: "triggered" };
		});
	}

	async function findSelection(tabId) {
		const frames = await getFrames(tabId);
		const outcomes = await Promise.allSettled(frames.map((frameId) => chrome.scripting.executeScript({
			target: { tabId, frameIds: [frameId] },
			func: () => {
				const focused = document.activeElement;
				if (focused?.matches("input, textarea") || focused?.isContentEditable) return null;
				const text = window.getSelection()?.toString().trim();
				return text ? { text, focused: document.hasFocus() } : null;
			},
		})));
		const selected = outcomes.flatMap((outcome, index) => {
			const result = outcome.status === "fulfilled" ? outcome.value[0]?.result : null;
			return result ? [{ ...result, frameId: frames[index] }] : [];
		});
		return selected.findLast((item) => item.focused) ?? selected[0];
	}

	async function updatePreferences(settings) {
		const stored = await chrome.storage.session.get(null);
		const tasks = [];
		for (const [key] of Object.entries(stored)) {
			if (!key.startsWith(SESSION_PREFIX)) continue;
			const tabId = Number(key.slice(SESSION_PREFIX.length));
			tasks.push(commands.run(tabId, async () => {
				const session = await getSession(tabId);
				if (!session) return;
				await Promise.allSettled((session.frames ?? [0]).map((frameId) => chrome.tabs.sendMessage(tabId, {
					type: "BT_PAGE_COMMAND", command: "preferences", settings: core.publicSettings(settings),
				}, { frameId })));
				await saveSession(tabId, { ...session, ...await getState(tabId) });
			}));
		}
		await Promise.allSettled(tasks);
	}

	async function refreshFrames(settings) {
		const stored = await chrome.storage.session.get(null);
		await Promise.allSettled(Object.entries(stored).filter(([key]) => key.startsWith(SESSION_PREFIX))
			.map(([key]) => {
				const tabId = Number(key.slice(SESSION_PREFIX.length));
				return commands.run(tabId, async () => {
					const state = await getState(tabId);
					if (state.active || state.selectionActive) await synchronize(tabId, state, settings);
					else await removeSession(tabId);
				});
			}));
	}

	function handleNavigation(details) {
		return commands.run(details.tabId, async () => {
			const session = await getSession(details.tabId);
			if (!session) return;
			if (details.frameId === 0) await removeSession(details.tabId);
			await onNavigation(details.tabId, details.frameId);
		});
	}

	async function handleFrameReady(details) {
		if (details.frameId === 0) return;
		return commands.run(details.tabId, async () => {
			const session = await getSession(details.tabId);
			if (!session || (!session.active && !session.selectionActive)) return;
			const settings = await settingsStore.getSettings();
			await sendCommand(details.tabId, details.frameId, {
				command: "sync", ...session, settings: core.publicSettings(settings),
			});
			await saveSession(details.tabId, {
				...session, frames: [...new Set([...(session.frames ?? [0]), details.frameId])],
			});
		});
	}

	async function removeSession(tabId) {
		await chrome.storage.session.remove(`${SESSION_PREFIX}${tabId}`);
	}

	function removeTab(tabId) {
		return commands.run(tabId, () => removeSession(tabId));
	}

	return { getState, toggle, toggleSelection, selection, updatePreferences, refreshFrames, handleNavigation, handleFrameReady, removeTab };
}

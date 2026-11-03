import { createKeyedSerialTaskQueue } from "./utilities.js";
import { createPageAccess } from "./page-access.js";

/** 所有页面入口复用同一套注入；访问不了的子框架不会阻断正文。 */
export function createPageService({ chrome, core, settingsStore, onNavigation, onDisabled }) {
	const commands = createKeyedSerialTaskQueue();
	const access = createPageAccess({ chrome, core });
	const { getSession, saveSession, removeSession, listSessions, getFrames } = access;

	async function getState(tabId) {
		try {
			return await chrome.tabs.sendMessage(tabId, { type: "BT_GET_PAGE_STATE" }, { frameId: 0 }) ?? { active: false, selectionActive: false };
		} catch {
			return { active: false, selectionActive: false };
		}
	}

	async function inject(tabId, frame) {
		const target = { tabId, documentIds: [frame.documentId] };
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

	async function sendCommand(tabId, frame, command) {
		await inject(tabId, frame);
		const response = await chrome.tabs.sendMessage(tabId, { type: "BT_PAGE_COMMAND", ...command }, { documentId: frame.documentId });
		if (!response?.ok) throw new Error(response?.error || "页面翻译模块没有响应，请刷新网页");
		return response;
	}

	async function synchronize(tabId, state, settings, expectedMain) {
		const command = { command: "sync", ...state, settings: core.publicSettings(settings) };
		const [main, ...frames] = await getFrames(tabId);
		if (main.documentId !== expectedMain.documentId) throw new Error("网页已切换，请重新启用翻译");
		// 内容脚本可能立即 START_RUN，必须先记录本次用户操作授权的具体文档。
		await saveSession(tabId, access.createSession(state, [main, ...frames]));
		try {
			// 由后台停止任务，不依赖页面能否及时收到关闭命令。
			await onDisabled(tabId, state);
			await sendCommand(tabId, main, command);
			const outcomes = await Promise.allSettled(frames.map((frame) => sendCommand(tabId, frame, command)));
			const injected = [main, ...frames.filter((_, index) => outcomes[index].status === "fulfilled")];
			await saveSession(tabId, access.createSession(state, injected));
			return { status: "triggered", ...state, skippedFrames: frames.length + 1 - injected.length };
		} catch (error) {
			await removeSession(tabId);
			throw error;
		}
	}

	function toggle(tab) {
		return commands.run(tab.id, async () => {
			const main = await getTarget(tab);
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
			}, settings, main);
		});
	}

	function toggleSelection(tab) {
		return commands.run(tab.id, async () => {
			const main = await getTarget(tab);
			const state = await getState(tab.id);
			const settings = await settingsStore.getSettings();
			return synchronize(tab.id, { active: state.active, selectionActive: !state.selectionActive }, settings, main);
		});
	}

	function selection(tab, text, frameId = 0, speakOnly = false) {
		return commands.run(tab.id, async () => {
			const main = await getTarget(tab);
			if (!text) {
				const selected = await findSelection(tab.id);
				if (!selected) throw new Error("请先选择需要翻译的文字");
				text = selected.text;
				frameId = selected.frameId;
			}
			const frame = (await getFrames(tab.id)).find((item) => item.frameId === frameId);
			if (!frame) throw new Error("请单独打开该嵌入网页后再翻译或朗读");
			const settings = await settingsStore.getSettings();
			const previous = await getState(tab.id);
			await synchronize(tab.id, {
				active: previous.active, selectionActive: true,
			}, settings, main);
			await sendCommand(tab.id, frame, {
				command: "selection",
				settings: core.publicSettings(settings),
				text,
				speakOnly,
			});
			return { status: "triggered" };
		});
	}

	async function getTarget(tab) {
		const [main] = await getFrames(tab.id);
		if (main.url !== tab.url) throw new Error("网页已切换，请重新启用翻译");
		return main;
	}

	async function findSelection(tabId) {
		const frames = await getFrames(tabId);
		const outcomes = await Promise.allSettled(frames.map(async (frame) => {
			try {
				return await chrome.tabs.sendMessage(tabId, { type: "BT_GET_SELECTION" }, { documentId: frame.documentId });
			} catch {
				const [result] = await chrome.scripting.executeScript({
					target: { tabId, documentIds: [frame.documentId] },
					func: () => {
						let focused = document.activeElement;
						while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
						if (focused?.matches("input, textarea") || focused?.isContentEditable) return null;
						const selection = window.getSelection();
						const excluded = "[data-bt-ui], input, textarea, [contenteditable]:not([contenteditable='false'])";
						for (const node of [selection?.anchorNode, selection?.focusNode]) {
							const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
							if (element?.closest(excluded)) return null;
						}
						const text = selection?.toString().trim();
						return text ? { text, focused: document.hasFocus() } : null;
					},
				});
				return result?.result ?? null;
			}
		}));
		const selected = outcomes.flatMap((outcome, index) => {
			const result = outcome.status === "fulfilled" ? outcome.value : null;
			return result ? [{ ...result, frameId: frames[index].frameId }] : [];
		});
		return selected.findLast((item) => item.focused) ?? selected[0];
	}

	async function updatePreferences(settings) {
		const tasks = [];
		for (const { tabId } of await listSessions()) {
			tasks.push(commands.run(tabId, async () => {
				const session = await getSession(tabId);
				if (!session) return;
				await Promise.allSettled((session.documents ?? []).map((frame) => chrome.tabs.sendMessage(tabId, {
					type: "BT_PAGE_COMMAND", command: "preferences", settings: core.publicSettings(settings),
				}, { documentId: frame.documentId })));
				await saveSession(tabId, { ...session, ...await getState(tabId) });
			}));
		}
		await Promise.allSettled(tasks);
	}

	function handleNavigation(details) {
		return commands.run(details.tabId, async () => {
			const session = await getSession(details.tabId);
			if (session && details.frameId === 0) await removeSession(details.tabId);
			else if (session) await saveSession(details.tabId, { ...session,
				documents: session.documents?.filter((frame) => frame.frameId !== details.frameId) ?? [],
			});
			await onNavigation(details.tabId, details.frameId);
		});
	}

	async function handleFrameReady(details) {
		if (details.frameId === 0) return;
		return commands.run(details.tabId, async () => {
			const session = await getSession(details.tabId);
			if (!session || (!session.active && !session.selectionActive)) return;
			const frames = await getFrames(details.tabId);
			if (frames[0].documentId !== session.documents?.find((frame) => frame.frameId === 0)?.documentId) return;
			const frame = frames.find((frame) => frame.frameId === details.frameId && frame.documentId === details.documentId);
			if (!frame) return;
			const previous = session.documents.filter((item) => item.frameId !== frame.frameId);
			await saveSession(details.tabId, { ...session,
				documents: [...previous, { frameId: frame.frameId, documentId: frame.documentId }],
			});
			const settings = await settingsStore.getSettings();
			try {
				await sendCommand(details.tabId, frame, {
					command: "sync", active: session.active, selectionActive: session.selectionActive,
					settings: core.publicSettings(settings),
				});
			} catch (error) {
				await saveSession(details.tabId, { ...session, documents: previous });
				throw error;
			}
		});
	}

	function removeTab(tabId) {
		return commands.run(tabId, () => removeSession(tabId));
	}

	return { getState, toggle, toggleSelection, selection, updatePreferences, handleNavigation, handleFrameReady, removeTab,
		assertSender: access.assertSender };
}

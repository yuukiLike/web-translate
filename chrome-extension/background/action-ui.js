import { ACTION_MENU_IDS } from "./constants.js";
import { getActionIconPaths, LOADING_ICON_STEPS } from "./action-icon-paths.js";
import { getErrorMessage, numberOrZero } from "./utilities.js";

const defaultIconPaths = getActionIconPaths();

export function createActionUi({ chrome, extensionVersion, settingsStore, pageService }) {
	const tabBadgeStates = new Map();

	async function initialize(settings) {
		await chrome.contextMenus.removeAll();
		chrome.contextMenus.create({ id: "translate-selection", title: "双语翻译选中文字", contexts: ["selection"] });
		chrome.contextMenus.create({ id: "speak-selection", title: "朗读选中的英语", contexts: ["selection"] });
		chrome.contextMenus.create({
			id: ACTION_MENU_IDS.debug,
			title: getDebugMenuTitle(settings),
			type: "checkbox",
			checked: settings.debugLogging,
			contexts: ["action"],
		});
		chrome.contextMenus.create({
			id: ACTION_MENU_IDS.openDebug,
			title: "打开详细调试面板",
			contexts: ["action"],
		});
		chrome.contextMenus.create({
			id: ACTION_MENU_IDS.version,
			title: `当前版本 v${extensionVersion}`,
			enabled: false,
			contexts: ["action"],
		});
		await updateState(settings);
		await normalizeLegacyBadges();
	}

	async function normalizeLegacyBadges() {
		// 标签页角标优先于全局角标；两处都处理，才能移除旧版本的 OK 和数字。
		await chrome.action.setBadgeText({ text: "" });
		const tabs = await chrome.tabs.query({});
		await Promise.allSettled(tabs.map(async (tab) => {
			if (!Number.isInteger(tab.id)) return;
			const text = await chrome.action.getBadgeText({ tabId: tab.id });
			const state = getLegacyBadgeState(text);
			if (!state || tabBadgeStates.has(tab.id)) return;
			const title = state === "error" || state === "settings-required"
				? await chrome.action.getTitle({ tabId: tab.id })
				: "";
			// 读取期间到达的新任务优先，初始化不能覆盖正在更新的角标。
			if (tabBadgeStates.has(tab.id)) return;
			await updateTabStatus(tab.id, { state, error: title.replace(/ · v\d+(?:\.\d+)*$/u, "") });
		}));
	}

	async function updateState(settings) {
		const debugState = settings.debugLogging
			? settings.debugRequestPayload
				? "调试已开启（含 DeepSeek 正文）"
				: "调试已开启（不含网页正文）"
			: "调试已关闭";
		await Promise.allSettled([
			chrome.action.setTitle({
				title: `打开翻译面板 · v${extensionVersion} · ${debugState}`,
			}),
			chrome.contextMenus.update(ACTION_MENU_IDS.debug, {
				checked: settings.debugLogging,
				title: getDebugMenuTitle(settings),
			}),
			chrome.contextMenus.update(ACTION_MENU_IDS.version, {
				title: `当前版本 v${extensionVersion}`,
			}),
		]);
	}

	async function handleMenuClick(info, tab) {
		if (["translate-selection", "speak-selection"].includes(info.menuItemId)) {
			const availability = getTabAvailability(tab);
			if (!availability.available) return;
			try {
				await pageService.selection(tab, info.selectionText, info.frameId ?? 0, info.menuItemId === "speak-selection");
			} catch (error) {
				await updateTabStatus(tab.id, { state: "error", error: getErrorMessage(error) });
			}
			return;
		}
		if (info.menuItemId === ACTION_MENU_IDS.debug) {
			const settings = await settingsStore.updateDebugLogging(info.checked === true);
			await updateState(settings);
			return;
		}
		if (info.menuItemId === ACTION_MENU_IDS.openDebug) {
			await chrome.tabs.create({
				url: chrome.runtime.getURL("options/index.html#debug"),
			});
		}
	}

	async function toggleTranslation(tab) {
		const availability = getTabAvailability(tab);
		if (!availability.available) {
			if (Number.isInteger(tab?.id)) {
				await updateTabStatus(tab.id, { state: "error", error: availability.reason });
			}
			return { status: "unavailable", error: availability.reason };
		}
		try {
			return await pageService.toggle(tab);
		} catch (error) {
			const message = getErrorMessage(error);
			if (error.requiresSettings) {
				await updateTabStatus(tab.id, { state: "settings-required", error: message });
				await chrome.runtime.openOptionsPage();
				return { status: "settings-required", error: message };
			}
			await updateTabStatus(tab.id, { state: "error", error: message });
			return { status: "error", error: message };
		}
	}

	function getTabAvailability(tab) {
		if (!tab || !Number.isInteger(tab.id)) {
			return { available: false, reason: "未找到当前标签页" };
		}
		if (!isInjectableUrl(tab.url)) {
			return { available: false, reason: "此页面不支持网页翻译" };
		}
		return { available: true, reason: "" };
	}

	async function updateTabStatus(tabId, message) {
		const previousRevision = tabBadgeStates.get(tabId)?.revision ?? 0;
		const badgeState = {
			...getBadgeState(message),
			revision: previousRevision + 1,
		};
		tabBadgeStates.set(tabId, badgeState);
		let pendingState = badgeState;
		while (pendingState) {
			await setBadge(tabId, pendingState);
			const latestState = tabBadgeStates.get(tabId);
			if (!latestState || latestState.revision === pendingState.revision) {
				return;
			}
			pendingState = latestState;
		}
	}

	function removeTab(tabId) {
		tabBadgeStates.delete(tabId);
	}

	function getBadgeState(message) {
		switch (message.state) {
			case "working": {
				const total = Math.max(0, Math.floor(numberOrZero(message.total)));
				const completed = Math.min(total, Math.max(0, Math.floor(numberOrZero(message.completed))));
				const progress = total > 0
					? ` · ${completed} / ${total} 个文本块（${Math.min(99, Math.round((completed / total) * 100))}%）`
					: "";
				const step = total > 0 ? Math.min(LOADING_ICON_STEPS - 1, Math.floor((completed / total) * LOADING_ICON_STEPS)) : 0;
				return {
					text: "", color: "#eff6ff", textColor: "#2563eb",
					title: `正在翻译${progress}`, iconPaths: getActionIconPaths(step),
				};
			}
			case "done":
				return { text: "✓", color: "#dcfce7", textColor: "#15803d", title: "当前网页已完成双语翻译" };
			case "error":
				return {
					text: "!",
					color: "#fee2e2",
					textColor: "#b91c1c",
					title: typeof message.error === "string" && message.error ? message.error : "翻译失败",
				};
			case "settings-required":
				return {
					text: "!",
					color: "#fef3c7",
					textColor: "#92400e",
					title: typeof message.error === "string" && message.error ? message.error : "请先配置翻译服务",
				};
			default:
				return { text: "", color: "#2563eb", title: "打开翻译面板" };
		}
	}

	async function setBadge(tabId, { text, color, title, textColor = "#ffffff", iconPaths = defaultIconPaths }) {
		await Promise.allSettled([
			chrome.action.setIcon({ tabId, path: iconPaths }),
			chrome.action.setBadgeText({ tabId, text }),
			chrome.action.setBadgeBackgroundColor({ tabId, color }),
			chrome.action.setBadgeTextColor?.({ tabId, color: textColor }),
			chrome.action.setTitle({ tabId, title: `${title} · v${extensionVersion}` }),
		]);
	}

	return {
		getTabAvailability,
		handleMenuClick,
		initialize,
		removeTab,
		toggleTranslation,
		updateState,
		updateTabStatus,
	};
}

function getLegacyBadgeState(text) {
	if (text === "•") return "working";
	if (text === "OK") return "done";
	if (text === "ERR") return "error";
	if (text === "SET") return "settings-required";
	return /^\d+%?$/u.test(text) ? "working" : null;
}

function getDebugMenuTitle(settings) {
	return settings.debugRequestPayload
		? "开发调试事件（含 DeepSeek 正文）"
		: "开发调试事件（不含网页正文）";
}

function isInjectableUrl(url) {
	return typeof url === "string" && /^(?:https?|file):/u.test(url);
}

import { ACTION_MENU_IDS } from "./constants.js";
import { getErrorMessage, numberOrZero } from "./utilities.js";

export function createActionUi({ chrome, extensionVersion, settingsStore }) {
	const tabBadgeStates = new Map();

	async function initialize(settings) {
		await chrome.contextMenus.removeAll();
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

	async function handleMenuClick(info) {
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
			if (tab?.id) {
				await setBadge(tab.id, "ERR", "#a33a32", availability.reason);
			}
			return { status: "unavailable", error: availability.reason };
		}
		try {
			const settings = await settingsStore.getSettings();
			try {
				settingsStore.assertProviderConfigured(settings);
				await settingsStore.assertProviderPermission(settings);
			} catch (error) {
				const message = getErrorMessage(error);
				await setBadge(tab.id, "SET", "#9a6700", message);
				await chrome.runtime.openOptionsPage();
				return { status: "settings-required", error: message };
			}
			await chrome.scripting.insertCSS({
				target: { tabId: tab.id },
				files: ["content/content.css"],
			});
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: [
					"generated/provider-catalog.js",
					"generated/core.js",
					"generated/content-script.js",
				],
			});
			return { status: "triggered" };
		} catch (error) {
			const message = getErrorMessage(error);
			await setBadge(tab.id, "ERR", "#a33a32", message);
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
			await setBadge(tabId, pendingState.text, pendingState.color, pendingState.title);
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
				const completed = numberOrZero(message.completed);
				const total = Math.max(1, numberOrZero(message.total));
				const percentage = String(Math.min(99, Math.round((completed / total) * 100)));
				return { text: percentage, color: "#285f9e", title: "正在翻译" };
			}
			case "done":
				return { text: "OK", color: "#287b50", title: "当前网页已完成双语翻译" };
			case "error":
				return {
					text: "ERR",
					color: "#a33a32",
					title: typeof message.error === "string" ? message.error : "翻译失败",
				};
			default:
				return { text: "", color: "#285f9e", title: "打开翻译面板" };
		}
	}

	async function setBadge(tabId, text, color, title) {
		await Promise.allSettled([
			chrome.action.setBadgeText({ tabId, text }),
			chrome.action.setBadgeBackgroundColor({ tabId, color }),
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

function getDebugMenuTitle(settings) {
	return settings.debugRequestPayload
		? "开发调试事件（含 DeepSeek 正文）"
		: "开发调试事件（不含网页正文）";
}

function isInjectableUrl(url) {
	return typeof url === "string" && /^(?:https?|file):/u.test(url);
}

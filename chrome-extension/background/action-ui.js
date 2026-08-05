import { ACTION_MENU_IDS } from "./constants.js";
import { getErrorMessage, numberOrZero } from "./utilities.js";

export function createActionUi({ chrome, extensionVersion, settingsStore }) {
	const tabBadgeStates = new Map();

	async function initialize(settings) {
		await chrome.contextMenus.removeAll();
		chrome.contextMenus.create({
			id: ACTION_MENU_IDS.debug,
			title: "开发调试模式",
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
		const debugState = settings.debugLogging ? "调试已开启" : "调试已关闭";
		await Promise.allSettled([
			chrome.action.setTitle({
				title: `翻译/恢复当前网页 · v${extensionVersion} · ${debugState}`,
			}),
			chrome.contextMenus.update(ACTION_MENU_IDS.debug, {
				checked: settings.debugLogging,
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
		if (!tab.id || !isInjectableUrl(tab.url)) {
			if (tab.id) {
				await setBadge(tab.id, "ERR", "#a33a32", "此页面不允许扩展注入脚本");
			}
			return;
		}
		try {
			const settings = await settingsStore.getSettings();
			try {
				settingsStore.assertProviderConfigured(settings);
				await settingsStore.assertProviderPermission(settings);
			} catch (error) {
				await setBadge(tab.id, "SET", "#9a6700", getErrorMessage(error));
				await chrome.runtime.openOptionsPage();
				return;
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
		} catch (error) {
			await setBadge(tab.id, "ERR", "#a33a32", getErrorMessage(error));
		}
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
				return { text: "", color: "#285f9e", title: "翻译/恢复当前网页" };
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
		handleMenuClick,
		initialize,
		removeTab,
		toggleTranslation,
		updateState,
		updateTabStatus,
	};
}

function isInjectableUrl(url) {
	return typeof url === "string" && /^(?:https?|file):/u.test(url);
}

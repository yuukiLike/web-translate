import {
	changeSourceLanguage,
	changeTargetLanguage,
	parseLanguagePair,
} from "./language-pair.js";
import { sendRuntimeMessage as sendMessage } from "./runtime-message.js";

const POPUP_PROTOCOL_VERSION = 2;
const DEFAULT_LANGUAGE_PAIR = Object.freeze({ sourceMode: "auto", targetLanguage: "zh" });
const ACTIONS = Object.freeze({ reload: "reload", translate: "translate" });
const ACTION_COPY = Object.freeze({
	[ACTIONS.reload]: Object.freeze({
		accessibleBusy: "正在重新载入扩展",
		accessibleIdle: "重新载入扩展",
		busy: "正在重新载入…",
		idle: "重新载入扩展",
	}),
	[ACTIONS.translate]: Object.freeze({
		accessibleBusy: "正在翻译当前网页",
		accessibleIdle: "翻译 / 恢复当前网页",
		busy: "正在处理…",
		idle: "翻译 / 恢复",
	}),
});

class PopupProtocolMismatchError extends Error {}

function getRequiredElement(document, selector) {
	const element = document.querySelector(selector);
	if (!element) throw new Error(`弹窗缺少必要元素：${selector}`);
	return element;
}

function getErrorMessage(error) {
	return error instanceof Error && error.message ? error.message : "扩展后台暂时无响应";
}

function isProtocolMismatch(error) {
	return (
		error instanceof PopupProtocolMismatchError ||
		/未知消息类型|unknown message type/iu.test(getErrorMessage(error))
	);
}

function isBackendTimeout(error) {
	return /后台响应超时/iu.test(getErrorMessage(error));
}

function readLanguagePair(response) {
	if (response.popupProtocolVersion !== POPUP_PROTOCOL_VERSION) {
		throw new PopupProtocolMismatchError("Popup 与扩展后台版本不一致");
	}
	try {
		return parseLanguagePair(response.languagePair);
	} catch {
		throw new PopupProtocolMismatchError("扩展后台返回了旧版语言配置");
	}
}

export function createPopupApp({ chrome, document, closePopup = () => {} }) {
	const elements = {
		debug: getRequiredElement(document, "#open-debug"),
		debugState: getRequiredElement(document, "#debug-state"),
		label: getRequiredElement(document, "#toggle-label"),
		languageFields: getRequiredElement(document, "#language-fields"),
		languageNote: getRequiredElement(document, "#language-note"),
		model: getRequiredElement(document, "#current-model"),
		provider: getRequiredElement(document, "#current-provider"),
		settings: getRequiredElement(document, "#open-settings"),
		source: getRequiredElement(document, "#source-language"),
		status: getRequiredElement(document, "#popup-status"),
		target: getRequiredElement(document, "#target-language"),
		toggle: getRequiredElement(document, "#toggle-translation"),
		version: getRequiredElement(document, "#extension-version"),
	};
	let busy = false;
	let languageBusy = false;
	let currentState;
	let savedLanguagePair = DEFAULT_LANGUAGE_PAIR;

	function showStatus(message, error = false, tone = "neutral") {
		elements.status.textContent = message;
		elements.status.dataset.error = String(error);
		elements.status.dataset.tone = error ? "error" : tone;
	}

	function renderLanguagePair(pair) {
		elements.source.value = pair.sourceMode;
		elements.target.value = pair.targetLanguage;
		elements.languageNote.textContent = getLanguageNote(pair);
	}

	function setLanguageControlsDisabled(disabled) {
		elements.languageFields.disabled = disabled;
	}

	function setLanguageBusy(nextBusy) {
		languageBusy = nextBusy;
		setLanguageControlsDisabled(nextBusy);
		elements.toggle.disabled =
			busy || nextBusy || elements.toggle.dataset.available !== "true";
	}

	function setAction(action, available) {
		const copy = ACTION_COPY[action];
		elements.toggle.dataset.action = action;
		elements.toggle.dataset.available = String(available);
		elements.toggle.setAttribute("aria-busy", "false");
		elements.toggle.disabled = busy || languageBusy || !available;
		elements.label.textContent = copy.idle;
		elements.toggle.setAttribute("aria-label", copy.accessibleIdle);
	}

	function setBusy(nextBusy) {
		const copy = ACTION_COPY[elements.toggle.dataset.action] ?? ACTION_COPY[ACTIONS.translate];
		busy = nextBusy;
		setLanguageControlsDisabled(
			nextBusy || languageBusy || elements.toggle.dataset.action === ACTIONS.reload,
		);
		elements.toggle.disabled =
			nextBusy || languageBusy || elements.toggle.dataset.available !== "true";
		elements.toggle.setAttribute("aria-busy", String(nextBusy));
		elements.label.textContent = nextBusy ? copy.busy : copy.idle;
		elements.toggle.setAttribute(
			"aria-label",
			nextBusy ? copy.accessibleBusy : copy.accessibleIdle,
		);
		if (nextBusy) showStatus(copy.accessibleBusy);
	}

	function showAvailability() {
		if (!currentState?.canTranslate) {
			showStatus(currentState?.unavailableReason || "当前页面不可翻译", true);
		} else if (!currentState.configured) {
			showStatus("翻译服务尚未配置，可先打开设置");
		} else {
			showStatus("准备就绪。再次执行可恢复原网页。", false, "ready");
		}
	}

	function showLoadFailure(error) {
		languageBusy = false;
		setLanguageControlsDisabled(true);
		elements.debugState.dataset.enabled = "false";
		if (isProtocolMismatch(error)) {
			elements.provider.textContent = "后台版本未同步";
			elements.model.textContent = "重新载入扩展后再试";
			elements.debugState.textContent = "待重载";
			setAction(ACTIONS.reload, true);
			showStatus("检测到旧版后台。重新载入扩展后，再次点击工具栏图标。", true);
			return;
		}
		if (isBackendTimeout(error)) {
			elements.provider.textContent = "后台响应超时";
			elements.model.textContent = "可重新载入扩展后再试";
			elements.debugState.textContent = "待恢复";
			setAction(ACTIONS.reload, true);
			showStatus("扩展后台长时间未响应，可以重新载入后再试。", true);
			return;
		}
		elements.provider.textContent = "后台暂时不可用";
		elements.model.textContent = "请稍后重试";
		elements.debugState.textContent = "不可用";
		setAction(ACTIONS.translate, false);
		showStatus(getErrorMessage(error), true);
	}

	async function load() {
		try {
			const state = await sendMessage(chrome, { type: "GET_POPUP_STATE" });
			savedLanguagePair = readLanguagePair(state);
			currentState = state;
			elements.version.textContent = `v${state.version}`;
			elements.provider.textContent = state.providerLabel || "尚未选择";
			elements.model.textContent = state.model || "无需选择模型";
			elements.debugState.textContent = state.debugLogging ? "记录中" : "已关闭";
			elements.debugState.dataset.enabled = String(Boolean(state.debugLogging));
			renderLanguagePair(savedLanguagePair);
			setLanguageControlsDisabled(false);
			setAction(ACTIONS.translate, Boolean(state.canTranslate));
			showAvailability();
		} catch (error) {
			showLoadFailure(error);
		}
	}

	async function saveLanguagePair(nextPair) {
		if (languageBusy || busy) return;
		const previousPair = savedLanguagePair;
		renderLanguagePair(nextPair);
		setLanguageBusy(true);
		showStatus("正在保存语言方向…");
		try {
			const response = await sendMessage(chrome, {
				type: "SET_LANGUAGE_PAIR",
				...nextPair,
			});
			savedLanguagePair = readLanguagePair(response);
			renderLanguagePair(savedLanguagePair);
			showStatus(
				`已设为 ${formatLanguagePair(savedLanguagePair)}，下次翻译生效。`,
				false,
				"ready",
			);
		} catch (error) {
			renderLanguagePair(previousPair);
			if (isProtocolMismatch(error)) {
				showLoadFailure(error);
				return;
			}
			showStatus(getErrorMessage(error), true);
		} finally {
			if (elements.toggle.dataset.action !== ACTIONS.reload) setLanguageBusy(false);
		}
	}

	async function reloadExtension() {
		setBusy(true);
		showStatus("正在重新载入扩展…");
		try {
			if (typeof chrome.runtime.reload !== "function") {
				throw new Error("请在 chrome://extensions 中手动重新加载本插件");
			}
			chrome.runtime.reload();
			closePopup();
		} catch (error) {
			showStatus(getErrorMessage(error), true);
			setBusy(false);
		}
	}

	async function toggleTranslation() {
		if (busy || languageBusy || elements.toggle.dataset.available !== "true") return;
		if (elements.toggle.dataset.action === ACTIONS.reload) {
			await reloadExtension();
			return;
		}
		setBusy(true);
		try {
			const result = await sendMessage(chrome, { type: "TOGGLE_ACTIVE_TAB" });
			if (result.status === "triggered" || result.status === "settings-required") {
				closePopup();
				return;
			}
			showStatus(result.error || "当前页面未执行翻译", true);
		} catch (error) {
			showStatus(getErrorMessage(error), true);
		} finally {
			setBusy(false);
		}
	}

	async function openSettings() {
		try {
			await chrome.runtime.openOptionsPage();
			closePopup();
		} catch (error) {
			showStatus(getErrorMessage(error), true);
		}
	}

	async function openDebug() {
		try {
			await chrome.tabs.create({ url: chrome.runtime.getURL("options/index.html#debug") });
			closePopup();
		} catch (error) {
			showStatus(getErrorMessage(error), true);
		}
	}

	elements.source.addEventListener("change", () => {
		void saveLanguagePair(changeSourceLanguage(savedLanguagePair, elements.source.value));
	});
	elements.target.addEventListener("change", () => {
		void saveLanguagePair(changeTargetLanguage(savedLanguagePair, elements.target.value));
	});
	elements.toggle.addEventListener("click", () => void toggleTranslation());
	elements.settings.addEventListener("click", () => void openSettings());
	elements.debug.addEventListener("click", () => void openDebug());

	return { load };
}

function formatLanguagePair(pair) {
	return `${getSourceLabel(pair.sourceMode)} → ${getTargetLabel(pair.targetLanguage)}`;
}

function getLanguageNote(pair) {
	return pair.sourceMode === "auto"
		? `自动检测输入；已是${getTargetLabel(pair.targetLanguage)}的内容会跳过`
		: `固定方向：${formatLanguagePair(pair)}`;
}

function getSourceLabel(sourceMode) {
	return sourceMode === "auto" ? "自动检测" : getTargetLabel(sourceMode);
}

function getTargetLabel(language) {
	return language === "zh" ? "简体中文" : "English";
}

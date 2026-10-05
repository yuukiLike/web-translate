import {
	changeSourceLanguage,
	changeTargetLanguage,
	parseLanguagePair,
} from "../core/language-selection.js";
import { ACTIONS, createPopupView, formatLanguagePair } from "./popup-view.js";
import { sendRuntimeMessage as sendMessage } from "./runtime-message.js";

const POPUP_PROTOCOL_VERSION = 3;
const DEFAULT_LANGUAGE_PAIR = Object.freeze({ sourceMode: "auto", targetLanguage: "zh" });

class PopupProtocolMismatchError extends Error {}

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
	const view = createPopupView(document);
	const { showStatus, renderLanguagePair } = view;
	let controls = {
		action: ACTIONS.translate,
		available: false,
		busy: "",
		languageEnabled: false,
		selectionActive: false,
	};
	let savedLanguagePair = DEFAULT_LANGUAGE_PAIR;
	let savedStyle = "soft";

	function setControls(nextControls) {
		controls = { ...controls, ...nextControls };
		view.renderControls(controls);
	}

	function showLoadFailure(error) {
		let reason = "unavailable";
		if (isProtocolMismatch(error)) reason = "protocol";
		else if (isBackendTimeout(error)) reason = "timeout";
		const canReload = reason !== "unavailable";
		view.showLoadFailure(reason, getErrorMessage(error));
		setControls({
			action: canReload ? ACTIONS.reload : ACTIONS.translate,
			available: canReload,
			busy: "",
			languageEnabled: false,
		});
	}

	async function load() {
		try {
			const state = await sendMessage(chrome, { type: "GET_POPUP_STATE" });
			savedLanguagePair = readLanguagePair(state);
			savedStyle = state.reading?.style ?? "soft";
			view.renderSummary(state);
			renderLanguagePair(savedLanguagePair);
			setControls({
				action: state.active ? ACTIONS.restore : ACTIONS.translate,
				available: Boolean(state.canTranslate),
				busy: "",
				languageEnabled: true,
				selectionActive: state.selectionActive === true,
			});
			view.showAvailability(state);
		} catch (error) {
			showLoadFailure(error);
		}
	}

	async function saveLanguagePair(nextPair) {
		if (controls.busy) return;
		const previousPair = savedLanguagePair;
		renderLanguagePair(nextPair);
		setControls({ busy: "language" });
		showStatus("正在保存语言方向…", false, "working");
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
			setControls({ busy: "" });
		}
	}

	async function changeStyle(style) {
		if (controls.busy) return;
		setControls({ busy: "reading" });
		showStatus("正在更新译文样式…", false, "working");
		try {
			const response = await sendMessage(chrome, { type: "SET_READING_PREFERENCES", reading: { style } });
			savedStyle = response.settings.reading.style;
			showStatus("译文样式已更新。", false, "ready");
		} catch (error) {
			document.querySelector("#reading-style").value = savedStyle;
			showStatus(getErrorMessage(error), true);
		} finally {
			setControls({ busy: "" });
		}
	}

	async function toggleSelection() {
		if (controls.busy || !controls.available) return;
		setControls({ busy: "reading" });
		showStatus("正在更新划词设置…", false, "working");
		try {
			const response = await sendMessage(chrome, { type: "TOGGLE_SELECTION" });
			setControls({ selectionActive: response.selectionActive === true });
			showStatus(response.selectionActive ? "划词已开启，选择文字后点击快捷按钮。" : "划词已关闭，仍可通过右键菜单翻译。", false, "ready");
		} catch (error) {
			showStatus(getErrorMessage(error), true);
		} finally {
			setControls({ busy: "" });
		}
	}

	async function reloadExtension() {
		setControls({ busy: "action" });
		showStatus("正在重新载入扩展…", false, "working");
		try {
			if (typeof chrome.runtime.reload !== "function") {
				throw new Error("请在 chrome://extensions 中手动重新加载本插件");
			}
			chrome.runtime.reload();
			closePopup();
		} catch (error) {
			showStatus(getErrorMessage(error), true);
			setControls({ busy: "" });
		}
	}

	async function toggleTranslation() {
		if (controls.busy || !controls.available) return;
		if (controls.action === ACTIONS.reload) {
			await reloadExtension();
			return;
		}
		setControls({ busy: "action" });
		view.showActionProgress(controls.action);
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
			setControls({ busy: "" });
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

	async function openReadingSettings() {
		try {
			await chrome.tabs.create({ url: chrome.runtime.getURL("options/index.html#reading") });
			closePopup();
		} catch (error) {
			showStatus(getErrorMessage(error), true);
		}
	}

	view.bindActions({
		changeSource(sourceMode) {
			void saveLanguagePair(changeSourceLanguage(savedLanguagePair, sourceMode));
		},
		changeTarget(targetLanguage) {
			void saveLanguagePair(changeTargetLanguage(savedLanguagePair, targetLanguage));
		},
		toggle: toggleTranslation,
		changeStyle,
		toggleSelection,
		openSettings,
		openReadingSettings,
	});

	return { load };
}

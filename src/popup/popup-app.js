function getRequiredElement(document, selector) {
	const element = document.querySelector(selector);
	if (!element) {
		throw new Error(`弹窗缺少必要元素：${selector}`);
	}
	return element;
}

function getErrorMessage(error) {
	return error instanceof Error && error.message ? error.message : "扩展后台暂时无响应";
}

async function sendMessage(chrome, message) {
	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		throw new Error(response?.error || "扩展后台暂时无响应");
	}
	return response;
}

export function createPopupApp({ chrome, document, closePopup = () => {} }) {
	const elements = {
		debug: getRequiredElement(document, "#open-debug"),
		debugState: getRequiredElement(document, "#debug-state"),
		model: getRequiredElement(document, "#current-model"),
		provider: getRequiredElement(document, "#current-provider"),
		settings: getRequiredElement(document, "#open-settings"),
		status: getRequiredElement(document, "#popup-status"),
		target: getRequiredElement(document, "#target-language"),
		toggle: getRequiredElement(document, "#toggle-translation"),
		version: getRequiredElement(document, "#extension-version"),
	};
	let busy = false;

	function showStatus(message, error = false) {
		elements.status.textContent = message;
		elements.status.dataset.error = String(error);
	}

	function setBusy(nextBusy) {
		busy = nextBusy;
		elements.toggle.disabled = nextBusy || elements.toggle.dataset.available !== "true";
		elements.toggle.querySelector("strong").textContent = nextBusy
			? "正在处理…"
			: "翻译 / 恢复当前网页";
	}

	async function load() {
		try {
			const state = await sendMessage(chrome, { type: "GET_POPUP_STATE" });
			elements.version.textContent = `v${state.version}`;
			elements.provider.textContent = state.providerLabel || "尚未选择";
			elements.model.textContent = state.model || "无需选择模型";
			elements.target.textContent = state.targetLanguage || "自动判断";
			elements.debugState.textContent = state.debugLogging ? "记录中" : "已关闭";
			elements.debugState.dataset.enabled = String(Boolean(state.debugLogging));
			elements.toggle.dataset.available = String(Boolean(state.canTranslate));
			elements.toggle.disabled = !state.canTranslate;
			if (!state.canTranslate) {
				showStatus(state.unavailableReason || "当前页面不可翻译", true);
			} else if (!state.configured) {
				showStatus("翻译服务尚未配置，可先打开设置");
			} else {
				showStatus("准备就绪。再次执行可恢复原网页。");
			}
		} catch (error) {
			elements.toggle.dataset.available = "false";
			elements.toggle.disabled = true;
			showStatus(getErrorMessage(error), true);
		}
	}

	async function toggleTranslation() {
		if (busy || elements.toggle.dataset.available !== "true") {
			return;
		}
		setBusy(true);
		try {
			const result = await sendMessage(chrome, { type: "TOGGLE_ACTIVE_TAB" });
			if (result.status === "triggered") {
				closePopup();
				return;
			}
			if (result.status === "settings-required") {
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

	elements.toggle.addEventListener("click", () => void toggleTranslation());
	elements.settings.addEventListener("click", () => void openSettings());
	elements.debug.addEventListener("click", () => void openDebug());

	return { load };
}

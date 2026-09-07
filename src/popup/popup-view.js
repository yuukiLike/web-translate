export const ACTIONS = Object.freeze({ reload: "reload", translate: "translate" });
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

const LOAD_FAILURE_COPY = Object.freeze({
	protocol: {
		provider: "后台版本未同步",
		model: "重新载入扩展后再试",
		debug: "待重载",
		status: "检测到旧版后台。重新载入扩展后，再次点击工具栏图标。",
	},
	timeout: {
		provider: "后台响应超时",
		model: "可重新载入扩展后再试",
		debug: "待恢复",
		status: "扩展后台长时间未响应，可以重新载入后再试。",
	},
	unavailable: { provider: "后台暂时不可用", model: "请稍后重试", debug: "不可用" },
});

function getRequiredElement(document, selector) {
	const element = document.querySelector(selector);
	if (!element) throw new Error(`弹窗缺少必要元素：${selector}`);
	return element;
}

export function createPopupView(document) {
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

	function renderSummary(state) {
		elements.version.textContent = `v${state.version}`;
		elements.provider.textContent = state.providerLabel || "尚未选择";
		elements.model.textContent = state.model || "无需选择模型";
		elements.debugState.textContent = state.debugLogging ? "记录中" : "已关闭";
		elements.debugState.dataset.enabled = String(Boolean(state.debugLogging));
	}

	function showLoadFailure(reason, errorMessage) {
		const copy = LOAD_FAILURE_COPY[reason];
		elements.provider.textContent = copy.provider;
		elements.model.textContent = copy.model;
		elements.debugState.textContent = copy.debug;
		elements.debugState.dataset.enabled = "false";
		showStatus(copy.status || errorMessage, true);
	}

	function renderControls(controls) {
		const copy = ACTION_COPY[controls.action];
		const actionBusy = controls.busy === "action";
		const anyBusy = controls.busy !== "";
		elements.languageFields.disabled =
			!controls.languageEnabled || anyBusy || controls.action === ACTIONS.reload;
		elements.toggle.dataset.action = controls.action;
		elements.toggle.dataset.available = String(controls.available);
		elements.toggle.disabled = anyBusy || !controls.available;
		elements.toggle.setAttribute("aria-busy", String(actionBusy));
		elements.label.textContent = actionBusy ? copy.busy : copy.idle;
		elements.toggle.setAttribute(
			"aria-label",
			actionBusy ? copy.accessibleBusy : copy.accessibleIdle,
		);
	}

	function showAvailability(state) {
		if (!state.canTranslate) {
			showStatus(state.unavailableReason || "当前页面不可翻译", false, "unavailable");
		} else if (!state.configured) {
			showStatus("翻译服务尚未配置，可先打开设置");
		} else {
			showStatus("准备就绪。再次执行可恢复原网页。", false, "ready");
		}
	}

	function showActionProgress(action) {
		showStatus(ACTION_COPY[action].accessibleBusy);
	}

	function bindActions({ changeSource, changeTarget, toggle, openSettings, openDebug }) {
		elements.source.addEventListener("change", () => changeSource(elements.source.value));
		elements.target.addEventListener("change", () => changeTarget(elements.target.value));
		elements.toggle.addEventListener("click", () => void toggle());
		elements.settings.addEventListener("click", () => void openSettings());
		elements.debug.addEventListener("click", () => void openDebug());
	}

	return {
		bindActions,
		showStatus,
		showLoadFailure,
		renderSummary,
		renderLanguagePair,
		renderControls,
		showAvailability,
		showActionProgress,
	};
}

export function formatLanguagePair(pair) {
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

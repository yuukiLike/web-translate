export const ACTIONS = Object.freeze({ reload: "reload", translate: "translate", restore: "restore" });
const ACTION_COPY = Object.freeze({
	[ACTIONS.reload]: Object.freeze({
		accessibleBusy: "正在重新载入扩展",
		accessibleIdle: "重新载入扩展",
		busy: "正在载入…",
		idle: "重新载入扩展",
	}),
	[ACTIONS.translate]: Object.freeze({
		accessibleBusy: "正在翻译当前网页",
		accessibleIdle: "翻译当前网页",
		busy: "正在处理…",
		idle: "翻译网页",
	}),
	[ACTIONS.restore]: Object.freeze({
		accessibleBusy: "正在恢复原文",
		accessibleIdle: "恢复原网页",
		busy: "正在恢复…",
		idle: "恢复原文",
	}),
});

const LOAD_FAILURE_COPY = Object.freeze({
	protocol: {
		provider: "后台版本未同步",
		model: "重新载入扩展后再试",
		status: "检测到旧版后台。重新载入扩展后，再次点击工具栏图标。",
	},
	timeout: {
		provider: "后台响应超时",
		model: "可重新载入扩展后再试",
		status: "扩展后台长时间未响应，可以重新载入后再试。",
	},
	unavailable: { provider: "后台暂时不可用", model: "请稍后重试" },
});

function getRequiredElement(document, selector) {
	const element = document.querySelector(selector);
	if (!element) throw new Error(`弹窗缺少必要元素：${selector}`);
	return element;
}

export function createPopupView(document) {
	const elements = {
		readingSettings: getRequiredElement(document, "#open-reading"),
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
		selection: getRequiredElement(document, "#toggle-selection"),
		readingStyle: getRequiredElement(document, "#reading-style"),
	};

	function showStatus(message, error = false, tone = "neutral") {
		elements.status.textContent = message;
		elements.status.dataset.error = String(error);
		elements.status.dataset.tone = error ? "error" : tone;
		elements.status.setAttribute("aria-busy", String(!error && tone === "working"));
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
		elements.provider.title = elements.provider.textContent;
		elements.model.title = elements.model.textContent;
		elements.readingStyle.value = state.reading?.style ?? "soft";
	}

	function showLoadFailure(reason, errorMessage) {
		const copy = LOAD_FAILURE_COPY[reason];
		elements.provider.textContent = copy.provider;
		elements.model.textContent = copy.model;
		elements.provider.title = copy.provider;
		elements.model.title = copy.model;
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
		elements.selection.disabled = anyBusy || !controls.available || controls.action === ACTIONS.reload;
		elements.selection.setAttribute("aria-pressed", String(Boolean(controls.selectionActive)));
		elements.selection.textContent = "划词翻译";
		elements.selection.title = controls.selectionActive ? "关闭划词翻译" : "开启划词翻译";
		elements.readingStyle.disabled = anyBusy || !controls.languageEnabled;
	}

	function showAvailability(state) {
		if (!state.canTranslate) {
			showStatus(state.unavailableReason || "当前页面不可翻译", false, "unavailable");
		} else if (!state.configured) {
			showStatus("翻译服务尚未配置，可先打开设置");
		} else {
			showStatus(state.active ? "双语阅读已开启，随时可恢复原文。" : "准备就绪，保留原文并逐段显示译文。", false, "ready");
		}
	}

	function showActionProgress(action) {
		showStatus(ACTION_COPY[action].accessibleBusy, false, "working");
	}

	function bindActions({ changeSource, changeTarget, changeStyle, toggleSelection, toggle, openSettings, openReadingSettings }) {
		elements.source.addEventListener("change", () => changeSource(elements.source.value));
		elements.target.addEventListener("change", () => changeTarget(elements.target.value));
		elements.toggle.addEventListener("click", () => void toggle());
		elements.settings.addEventListener("click", () => void openSettings());
		elements.readingSettings.addEventListener("click", () => void openReadingSettings());
		elements.readingStyle.addEventListener("change", () => void changeStyle(elements.readingStyle.value));
		elements.selection.addEventListener("click", () => void toggleSelection());
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

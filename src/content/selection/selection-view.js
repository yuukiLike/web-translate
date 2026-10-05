import selectionCss from "./selection.css";

/** 闭合 Shadow DOM 隔离站点样式；所有选中文字和译文都作为纯文本展示。 */
export class SelectionView {
	#host = null;
	#root = null;
	#anchor = null;
	#previousFocus = null;
	panelOpen = false;

	constructor(actions) {
		this.actions = actions;
	}

	contains(event) {
		return Boolean(this.#host && event.composedPath().includes(this.#host));
	}

	showLauncher(rectangle) {
		this.remove();
		const root = this.#mount();
		const launcher = button("翻译 / 朗读", "launcher", () => this.actions.translate());
		launcher.setAttribute("aria-label", "翻译选中文字，或朗读英语");
		launcher.addEventListener("pointerdown", (event) => event.preventDefault());
		root.append(launcher);
		this.position(rectangle);
	}

	showPanel(text, sourceLanguage) {
		this.remove();
		const root = this.#mount();
		this.panelOpen = true;
		this.#previousFocus = document.activeElement;
		const panel = createElement("section", "panel");
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-label", "划词双语翻译");
		const header = createElement("header", "header");
		header.append(createElement("strong", "title", "划词翻译"));
		const close = button("×", "close", () => this.actions.close());
		close.setAttribute("aria-label", "关闭划词翻译");
		header.append(close);
		const source = createElement("div", "source");
		this.sourceLabel = createElement("span", "label", languageLabel(sourceLanguage));
		const sourceText = createElement("p", "text", text);
		sourceText.lang = sourceLanguage;
		source.append(this.sourceLabel, sourceText);
		const result = createElement("div", "result");
		this.targetLabel = createElement("span", "label", "译文");
		this.resultText = createElement("p", "text", "正在翻译…");
		this.resultText.setAttribute("role", "status");
		this.resultText.setAttribute("aria-live", "polite");
		result.append(this.targetLabel, this.resultText);
		const controls = createElement("div", "controls");
		this.speakButton = button("朗读英语", "primary", () => this.actions.speak());
		this.speakButton.disabled = sourceLanguage !== "en";
		this.copyButton = button("复制译文", "secondary", () => this.actions.copy());
		this.copyButton.disabled = true;
		this.retryButton = button("重新翻译", "secondary", () => this.actions.translate());
		this.retryButton.hidden = true;
		controls.append(this.speakButton, this.copyButton, this.retryButton);
		const footer = createElement("footer", "footer");
		this.notice = createElement("span", "notice", "Esc 关闭 · 仅翻译选中的文字");
		this.notice.setAttribute("role", "status");
		footer.append(this.notice, button("设置", "settings", () => this.actions.settings()));
		panel.append(header, source, result, controls, footer);
		root.append(panel);
		this.position(this.#anchor);
		close.focus({ preventScroll: true });
	}

	loading() {
		this.resultText.textContent = "正在翻译…";
		this.resultText.dataset.error = "false";
		this.resultText.setAttribute("aria-busy", "true");
		this.copyButton.disabled = true;
		this.retryButton.hidden = true;
	}

	showResult(response) {
		if (!this.panelOpen) return;
		this.sourceLabel.textContent = languageLabel(response.sourceLanguage);
		this.targetLabel.textContent = languageLabel(response.targetLanguage);
		this.resultText.textContent = response.text;
		this.resultText.lang = response.targetLanguage;
		this.resultText.setAttribute("aria-busy", "false");
		this.resultText.dataset.error = "false";
		this.copyButton.disabled = false;
		this.speakButton.disabled = false;
		this.position(this.#anchor);
	}

	showError(message) {
		if (!this.panelOpen) return;
		this.resultText.textContent = message;
		this.resultText.dataset.error = "true";
		this.resultText.setAttribute("aria-busy", "false");
		this.retryButton.hidden = false;
		this.position(this.#anchor);
	}

	showSpeech(state, engine = "") {
		if (!this.panelOpen) return;
		this.speakButton.textContent = state === "loading" ? "停止准备" : state === "playing" ? "停止朗读" : "朗读英语";
		this.speakButton.setAttribute("aria-pressed", String(state !== "idle"));
		if (state === "playing") this.setNotice(`${engine === "edge" ? "Edge TTS" : "系统语音"} · 正在朗读英语`);
		else if (state === "loading") this.setNotice("正在准备英语发音…");
	}

	setNotice(text, error = false) {
		if (!this.panelOpen) return;
		this.notice.textContent = text;
		this.notice.dataset.error = String(error);
	}

	position(rectangle = this.#anchor) {
		if (!this.#host) return;
		this.#anchor = rectangle;
		const viewport = window.visualViewport;
		const width = viewport?.width ?? window.innerWidth;
		const height = viewport?.height ?? window.innerHeight;
		const left = viewport?.offsetLeft ?? 0;
		const top = viewport?.offsetTop ?? 0;
		this.#host.style.setProperty("--panel-width", `${Math.max(180, Math.min(390, width - 24))}px`);
		this.#host.style.setProperty("--panel-height", `${Math.max(120, height - 24)}px`);
		const box = this.#host.getBoundingClientRect();
		const anchor = rectangle ?? { left: left + width / 2 - box.width / 2, top: top + 60, bottom: top + 60 };
		const x = clamp(anchor.left, left + 12, left + width - box.width - 12);
		const below = anchor.bottom + 10;
		const y = clamp(below + box.height <= top + height - 12 ? below : anchor.top - box.height - 10,
			top + 12, top + height - box.height - 12);
		this.#host.style.setProperty("left", `${x}px`, "important");
		this.#host.style.setProperty("top", `${y}px`, "important");
	}

	remove() {
		const focused = document.activeElement === this.#host;
		this.#host?.remove();
		this.#host = null;
		this.#root = null;
		this.panelOpen = false;
		if (focused && this.#previousFocus?.isConnected) this.#previousFocus.focus({ preventScroll: true });
		this.#previousFocus = null;
	}

	#mount() {
		const host = document.createElement("div");
		host.dataset.btOwned = "true";
		host.dataset.btUi = "selection";
		host.setAttribute("translate", "no");
		host.popover = "manual";
		const root = host.attachShadow({ mode: "closed" });
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(selectionCss);
		root.adoptedStyleSheets = [sheet];
		document.documentElement.append(host);
		host.showPopover();
		this.#host = host;
		this.#root = root;
		return root;
	}
}

function createElement(tag, className, text = "") {
	const node = document.createElement(tag);
	if (className) node.className = className;
	node.textContent = text;
	return node;
}

function button(text, className, onClick) {
	const node = createElement("button", className, text);
	node.type = "button";
	node.addEventListener("click", onClick);
	return node;
}

function languageLabel(language) {
	return language === "en" ? "ENGLISH" : "简体中文";
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

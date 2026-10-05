import selectionCss from "./selection.css";
import { closestComposed, textParent } from "../dom/node-utils.js";
import { activeElement } from "./selection-snapshot.js";
import { SelectionPosition } from "./selection-position.js";

let stylesheet = null;

/** 闭合 Shadow DOM 隔离站点样式；来源与译文始终以纯文本展示。 */
export class SelectionView {
	#host = null;
	#position = null;
	#previousFocus = null;
	#elements = null;
	#speechAllowed = false;
	#speechState = "idle";
	panelOpen = false;

	constructor(actions) { this.actions = actions; }

	get visible() { return Boolean(this.#host); }
	get focused() { return Boolean(this.#host && activeElement() === this.#host); }

	contains(event) {
		return Boolean(this.#host && event.composedPath().includes(this.#host));
	}

	showLauncher(snapshot, canSpeak) {
		this.remove({ restoreFocus: false });
		this.#previousFocus = activeElement();
		const root = this.#mount(snapshot, false);
		const launcher = createElement("div", "launcher");
		launcher.setAttribute("role", "toolbar");
		launcher.setAttribute("aria-label", "选中文字的操作");
		launcher.append(button("翻译", "launch-action", this.actions.translate));
		if (canSpeak) launcher.append(button("朗读", "launch-action", this.actions.speak));
		// 鼠标点击操作不会清除页面选区；键盘点击仍能正常获得焦点。
		launcher.addEventListener("pointerdown", (event) => event.preventDefault());
		root.append(launcher);
	}

	showPanel(snapshot, sourceLanguage, { focus = false } = {}) {
		const previousFocus = this.focused ? this.#previousFocus : activeElement();
		this.remove({ restoreFocus: false });
		this.#previousFocus = previousFocus;
		const root = this.#mount(snapshot, true);
		this.panelOpen = true;
		const panel = createElement("section", "panel");
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-label", "中英划词翻译");
		panel.tabIndex = -1;
		const header = createElement("header", "header");
		const close = button("×", "close", this.actions.close);
		close.setAttribute("aria-label", "关闭划词翻译");
		header.append(createElement("strong", "title", "划词翻译"), close);
		const body = createElement("div", "body");
		const source = createElement("details", "source");
		source.open = snapshot.text.length <= 280;
		const summary = createElement("summary", "source-summary");
		const sourceLabel = createElement("span", "label", languageLabel(sourceLanguage));
		summary.append(sourceLabel, createElement("span", "source-caption", `原文 · ${snapshot.text.length.toLocaleString()} 字符`));
		const preview = snapshot.text.length > 12_000 ? `${snapshot.text.slice(0, 12_000)}…` : snapshot.text;
		const sourceText = createElement("p", "text", preview);
		sourceText.lang = sourceLanguage;
		source.append(summary, sourceText);
		const result = createElement("div", "result");
		const targetLabel = createElement("span", "label", "译文");
		const resultText = createElement("p", "text");
		resultText.setAttribute("role", "status");
		resultText.setAttribute("aria-live", "polite");
		result.append(targetLabel, resultText);
		body.append(source, result);
		const bottom = createElement("div", "bottom");
		const controls = createElement("div", "controls");
		const speak = button("朗读英语", "primary", this.actions.speak);
		const copy = button("复制译文", "secondary", this.actions.copy);
		const translate = button("翻译", "secondary", this.actions.translate);
		copy.disabled = true;
		controls.append(speak, copy, translate);
		const footer = createElement("footer", "footer");
		const notice = createElement("span", "notice", "Esc 关闭");
		notice.setAttribute("role", "status");
		footer.append(notice, button("设置", "settings", this.actions.settings));
		bottom.append(controls, footer);
		panel.append(header, body, bottom);
		root.append(panel);
		this.#elements = { sourceLabel, targetLabel, resultText, speak, copy, translate, notice };
		this.#speechState = "idle";
		this.showIdle();
		if (focus) requestAnimationFrame(() => {
			if (this.#host === root.host) panel.focus({ preventScroll: true });
		});
	}

	showIdle() {
		if (!this.#elements) return;
		this.#elements.resultText.textContent = "点击「翻译」查看中英译文";
		this.#elements.resultText.dataset.state = "idle";
		this.#elements.translate.textContent = "翻译";
	}

	loading() {
		if (!this.#elements) return;
		const { resultText, copy, translate } = this.#elements;
		resultText.textContent = "正在翻译…";
		resultText.removeAttribute("lang");
		resultText.dataset.state = "loading";
		resultText.setAttribute("aria-busy", "true");
		copy.disabled = true;
		translate.disabled = true;
		this.setNotice("仅发送选中的文字");
	}

	showResult(response) {
		if (!this.#elements) return;
		const { sourceLabel, targetLabel, resultText, copy, translate } = this.#elements;
		sourceLabel.textContent = languageLabel(response.sourceLanguage);
		targetLabel.textContent = languageLabel(response.targetLanguage);
		resultText.textContent = response.text;
		resultText.lang = response.targetLanguage;
		resultText.dataset.state = "ready";
		resultText.setAttribute("aria-busy", "false");
		copy.disabled = false;
		translate.disabled = false;
		translate.textContent = "重新翻译";
		if (this.#speechState === "idle") this.setNotice("Esc 关闭");
	}

	showError(message) {
		if (!this.#elements) return;
		const { resultText, copy, translate } = this.#elements;
		resultText.textContent = message;
		resultText.removeAttribute("lang");
		resultText.dataset.state = "error";
		resultText.setAttribute("aria-busy", "false");
		copy.disabled = true;
		translate.disabled = false;
		translate.textContent = "重试翻译";
		this.setNotice("可重试，或打开设置检查翻译服务", true);
	}

	setSpeechAvailable(allowed, reason = "") {
		this.#speechAllowed = allowed;
		if (!this.#elements) return;
		this.#elements.speak.disabled = this.#speechState === "idle" && !allowed;
		this.#elements.speak.title = allowed ? "朗读英语原文或英语译文" : reason;
	}

	showSpeech(state, engine = "") {
		this.#speechState = state;
		if (!this.#elements) return;
		const { speak } = this.#elements;
		speak.dataset.state = state;
		speak.textContent = state === "loading" ? "停止准备" : state === "playing" ? "停止朗读" : "朗读英语";
		speak.setAttribute("aria-pressed", String(state !== "idle"));
		speak.disabled = state === "idle" && !this.#speechAllowed;
		if (state === "playing") this.setNotice(`${engine === "edge" ? "Edge TTS" : "系统语音"} · 正在朗读`);
		else if (state === "loading") this.setNotice("正在准备英语发音…");
	}

	setNotice(text, error = false) {
		if (!this.#elements) return;
		this.#elements.notice.textContent = text;
		this.#elements.notice.dataset.error = String(error);
	}

	selectTranslation() {
		const text = this.#elements?.resultText;
		if (!text) return;
		text.tabIndex = -1;
		text.focus({ preventScroll: true });
		const range = document.createRange();
		range.selectNodeContents(text);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	remove({ restoreFocus = true } = {}) {
		const focused = this.focused;
		this.#position?.dispose();
		this.#position = null;
		this.#host?.remove();
		this.#host = null;
		this.#elements = null;
		this.panelOpen = false;
		if (restoreFocus && focused && this.#previousFocus?.isConnected) this.#previousFocus.focus?.({ preventScroll: true });
		this.#previousFocus = null;
	}

	#mount(snapshot, panel) {
		const host = document.createElement("div");
		host.dataset.btOwned = "true";
		host.dataset.btUi = "selection";
		host.setAttribute("translate", "no");
		host.popover = "manual";
		const root = host.attachShadow({ mode: "closed" });
		host.addEventListener("toggle", (event) => {
			if (this.#host === host && event.newState === "closed") this.actions.lost();
		});
		if (!stylesheet) {
			stylesheet = new CSSStyleSheet();
			stylesheet.replaceSync(selectionCss);
		}
		root.adoptedStyleSheets = [stylesheet];
		const sourceNode = snapshot.boundary?.startContainer;
		const sourceElement = sourceNode?.nodeType === Node.ELEMENT_NODE ? sourceNode : sourceNode ? textParent(sourceNode) : null;
		const modal = closestComposed(sourceElement, "dialog:modal") ?? closestComposed(activeElement(), "dialog:modal");
		// 模态框外的节点会被浏览器设为 inert；操作浮层必须留在当前模态框内。
		(modal ?? document.documentElement).append(host);
		host.showPopover();
		this.#host = host;
		this.#position = new SelectionPosition(host, snapshot, { panel, onLost: this.actions.lost });
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

function languageLabel(language) { return language === "en" ? "ENGLISH" : "简体中文"; }

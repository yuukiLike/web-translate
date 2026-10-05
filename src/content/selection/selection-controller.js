import { closestComposed, textParent } from "../dom/node-utils.js";
import { SelectionView } from "./selection-view.js";

/** 选择只在本机预览；点击翻译或发音时才向后台提交文字。 */
export class SelectionController {
	#listeners = null;
	#timer = null;
	#selecting = false;
	#selection = null;
	#requestId = null;
	#speechId = null;
	#response = null;
	#dismissedText = "";
	active = false;

	constructor({ core, runtime }) {
		this.core = core;
		this.runtime = runtime;
		this.view = new SelectionView({
			translate: () => void this.translate(),
			speak: () => void this.speak(),
			copy: () => void this.copy(),
			close: () => this.close(),
			settings: () => void this.runtime.openOptions().catch((error) => this.view.setNotice(error.message, true)),
		});
	}

	enable() {
		if (this.active) return;
		this.active = true;
		this.#listeners = new AbortController();
		const options = { signal: this.#listeners.signal };
		document.addEventListener("pointerdown", (event) => {
			if (this.view.contains(event)) return;
			this.#selecting = true;
			this.close();
			this.#dismissedText = "";
		}, options);
		document.addEventListener("pointerup", () => {
			this.#selecting = false;
			this.#schedule();
		}, options);
		document.addEventListener("selectionchange", () => this.#schedule(), options);
		document.addEventListener("keyup", () => this.#schedule(), options);
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape") this.close();
		}, options);
		window.addEventListener("scroll", () => {
			if (!this.view.panelOpen) this.view.remove();
		}, { ...options, capture: true, passive: true });
		window.addEventListener("resize", () => this.view.position(), options);
		window.addEventListener("pagehide", () => this.disable(), options);
	}

	disable() {
		this.active = false;
		this.#listeners?.abort();
		this.#listeners = null;
		this.close();
	}

	open(text = "", speakOnly = false) {
		this.enable();
		const selected = this.#readSelection();
		if (text) this.#selection = { text: this.core.normalizeSourceText(text), rectangle: selected?.rectangle };
		else if (selected) this.#selection = selected;
		if (!this.#selection?.text) throw new Error("请先选择需要翻译的文字");
		this.#response = null;
		const source = this.core.getLanguagePair("", this.#selection.text).sourceLanguage;
		this.view.showPanel(this.#selection.text, source);
		this.view.position(this.#selection.rectangle);
		if (speakOnly) {
			this.view.showError("点击「重新翻译」查看双语译文");
			this.view.resultText.dataset.error = "false";
			void this.speak();
		} else void this.translate();
	}

	async translate() {
		if (!this.#selection) return;
		if (!this.view.panelOpen) {
			this.open(this.#selection.text);
			return;
		}
		this.#cancelTranslation();
		this.#response = null;
		const requestId = crypto.randomUUID();
		this.#requestId = requestId;
		this.view.loading();
		try {
			const response = await this.runtime.send({ type: "TRANSLATE_SELECTION", requestId, text: this.#selection.text });
			if (this.#requestId !== requestId || !this.view.panelOpen) return;
			this.#response = response;
			this.view.showResult(response);
		} catch (error) {
			if (this.#requestId === requestId) this.view.showError(error.message);
		} finally {
			if (this.#requestId === requestId) this.#requestId = null;
		}
	}

	async speak() {
		if (this.#speechId) {
			this.#stopSpeech();
			return;
		}
		if (!this.#selection) return;
		const sourceLanguage = this.#response?.sourceLanguage ?? this.core.getLanguagePair("", this.#selection.text).sourceLanguage;
		const text = sourceLanguage === "en" ? this.#selection.text : this.#response?.text;
		if (!text) {
			this.view.setNotice("英语译文完成后即可朗读", true);
			return;
		}
		const requestId = crypto.randomUUID();
		this.#speechId = requestId;
		this.view.showSpeech("loading");
		try {
			const response = await this.runtime.send({ type: "SPEAK_TEXT", requestId, text });
			if (this.#speechId !== requestId) return;
			if (response.cancelled) this.#stopSpeech();
			else this.view.showSpeech("playing", response.engine);
		} catch (error) {
			if (this.#speechId !== requestId) return;
			this.#speechId = null;
			this.view.showSpeech("idle");
			this.view.setNotice(error.message, true);
		}
	}

	onSpeechEvent(message) {
		if (this.#speechId !== message.requestId) return;
		if (["end", "cancelled", "interrupted", "error"].includes(message.state)) {
			this.#speechId = null;
			this.view.showSpeech("idle");
			this.view.setNotice(message.error || "朗读已结束", message.state === "error");
		}
	}

	async copy() {
		if (!this.#response?.text) return;
		try {
			await navigator.clipboard.writeText(this.#response.text);
			this.view.setNotice("译文已复制");
		} catch {
			this.view.setNotice("无法访问剪贴板，请直接选中译文复制", true);
		}
	}

	close() {
		this.#dismissedText = this.#selection?.text ?? "";
		clearTimeout(this.#timer);
		this.#timer = null;
		this.#cancelTranslation();
		this.#stopSpeech();
		this.view.remove();
		this.#response = null;
	}

	#cancelTranslation() {
		if (!this.#requestId) return;
		void this.runtime.send({ type: "CANCEL_SELECTION", requestId: this.#requestId }).catch(() => {});
		this.#requestId = null;
	}

	#stopSpeech() {
		if (this.#speechId) void this.runtime.send({ type: "STOP_SPEECH", requestId: this.#speechId }).catch(() => {});
		this.#speechId = null;
		this.view.showSpeech("idle");
	}

	#schedule() {
		if (this.#selecting || this.view.panelOpen) return;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			const selected = this.#readSelection();
			if (!selected || selected.text === this.#dismissedText) {
				this.view.remove();
				return;
			}
			this.#selection = selected;
			this.view.showLauncher(selected.rectangle);
		}, 140);
	}

	#readSelection() {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
		const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
			? selection.anchorNode : selection.anchorNode ? textParent(selection.anchorNode) : null;
		if (closestComposed(anchor, "[data-bt-ui], input, textarea, [contenteditable]:not([contenteditable='false'])")) return null;
		const text = this.core.normalizeSourceText(selection.toString());
		if (!text || !/\p{L}/u.test(text)) return null;
		const rectangles = [...selection.getRangeAt(0).getClientRects()];
		const rectangle = rectangles.findLast((rect) => rect.width > 0 && rect.height > 0);
		return { text, rectangle };
	}
}

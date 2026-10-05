import { captureSelection, isEditingEvent, sameSelection } from "./selection-snapshot.js";

const SELECTION_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** 只响应用户完成的选择。网站程序修改 Selection 不会自动弹出翻译按钮。 */
export class SelectionTracker {
	#listeners = null;
	#timer = null;
	#pointer = null;
	#keyboard = false;
	#intentUntil = 0;
	#last = null;

	constructor({ core, view, onSelection, onOutside, onEscape }) {
		Object.assign(this, { core, view, onSelection, onOutside, onEscape });
	}

	enable() {
		if (this.#listeners) return;
		this.#listeners = new AbortController();
		const options = { capture: true, signal: this.#listeners.signal };
		window.addEventListener("pointerdown", (event) => this.#pointerDown(event), options);
		window.addEventListener("pointerup", (event) => this.#pointerEnd(event), options);
		window.addEventListener("pointercancel", (event) => this.#pointerEnd(event, true), options);
		window.addEventListener("pointermove", (event) => {
			if (event.pointerType === "mouse" && event.buttons === 0) this.#pointerEnd(event);
		}, options);
		document.addEventListener("selectionchange", () => this.#selectionChanged(), options);
		window.addEventListener("keydown", (event) => this.#keyDown(event), options);
		window.addEventListener("keyup", (event) => {
			if (!this.#keyboard || (!SELECTION_KEYS.has(event.key) &&
				!["a", "A", "Shift", "Control", "Meta"].includes(event.key))) return;
			this.#keyboard = false;
			this.#schedule();
		}, options);
		window.addEventListener("blur", () => {
			this.dismiss();
			if (!this.view.panelOpen) this.onSelection(null);
		}, options);
	}

	disable() {
		this.#listeners?.abort();
		this.#listeners = null;
		this.dismiss();
	}

	dismiss() {
		clearTimeout(this.#timer);
		this.#timer = null;
		this.#pointer = null;
		this.#keyboard = false;
		this.#intentUntil = 0;
		this.#last = null;
	}

	#pointerDown(event) {
		if (!event.isTrusted || this.view.contains(event) || event.button !== 0 || !event.isPrimary) return;
		this.onOutside();
		this.dismiss();
		if (isEditingEvent(event)) return;
		this.#pointer = { id: event.pointerId, type: event.pointerType };
		this.#intentUntil = Date.now() + 2_000;
	}

	#pointerEnd(event, cancelled = false) {
		if (this.#pointer?.id !== event.pointerId) return;
		const touch = this.#pointer.type === "touch";
		this.#pointer = null;
		if (cancelled && !touch) {
			this.dismiss();
			return;
		}
		// 原生触摸选择可能在 pointercancel 后才建立选区。
		this.#intentUntil = Date.now() + (touch ? 2_000 : 500);
		this.#schedule();
	}

	#keyDown(event) {
		if (!event.isTrusted || event.isComposing) return;
		if (event.key === "Escape" && this.view.visible && !isEditingEvent(event)) {
			event.preventDefault();
			event.stopPropagation();
			this.onEscape();
			return;
		}
		if (this.view.contains(event) || isEditingEvent(event) || !isSelectionKey(event)) return;
		this.onOutside();
		this.#keyboard = true;
		this.#intentUntil = Date.now() + 1_000;
	}

	#selectionChanged() {
		if (this.view.panelOpen || this.#pointer || this.#keyboard) return;
		if (Date.now() < this.#intentUntil) this.#schedule();
		else if (this.#last && !sameSelection(this.#last, captureSelection(this.core))) {
			this.dismiss();
			this.onSelection(null);
		}
	}

	#schedule() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			if (this.view.panelOpen || this.#pointer || this.#keyboard || !document.hasFocus()) return;
			const snapshot = captureSelection(this.core);
			if (!snapshot && !this.#last && !this.view.visible) return;
			if (sameSelection(this.#last, snapshot)) return;
			this.#last = snapshot;
			this.onSelection(snapshot);
		}, 80);
	}
}

function isSelectionKey(event) {
	return (event.shiftKey && SELECTION_KEYS.has(event.key)) ||
		((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !event.altKey);
}

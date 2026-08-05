import { TIMING } from "./constants.js";

/** 页面右上角状态提示；仅负责 DOM，不发送运行时消息。 */
export class StatusView {
	#node = null;
	#timer = null;

	show(text, action = null) {
		this.#clearTimer();
		const status = this.#ensureNode();
		status.querySelector(".bt-status__text").textContent = text;
		status.querySelector(".bt-status__action")?.remove();
		if (action) {
			status.append(createActionButton(action));
		}
	}

	hideAfterCompletion() {
		this.#clearTimer();
		this.#timer = setTimeout(() => this.remove(), TIMING.completionToast);
	}

	remove() {
		this.#clearTimer();
		this.#node?.remove();
		this.#node = null;
	}

	#clearTimer() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
	}

	#ensureNode() {
		if (this.#node?.isConnected) {
			return this.#node;
		}
		const status = document.createElement("div");
		status.className = "bt-status";
		status.dataset.btOwned = "true";
		status.setAttribute("role", "status");
		status.setAttribute("aria-live", "polite");

		const text = document.createElement("span");
		text.className = "bt-status__text";
		text.dataset.btOwned = "true";
		status.append(text);
		document.documentElement.append(status);
		this.#node = status;
		return status;
	}
}

function createActionButton(action) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "bt-status__action";
	button.dataset.btOwned = "true";
	button.textContent = action.label;
	button.addEventListener("click", action.onClick, { once: true });
	return button;
}

import { selectionConnected, selectionRectangle, selectionRoots } from "./selection-snapshot.js";
import { closestComposed } from "../dom/node-utils.js";

/** 定位跟随保存的 Range，而不是打开浮层前的一次性坐标。 */
export class SelectionPosition {
	#listeners = new AbortController();
	#resize = null;
	#mutations = null;
	#frame = null;

	constructor(host, snapshot, { panel, onLost }) {
		Object.assign(this, { host, snapshot, panel, onLost });
		const options = { signal: this.#listeners.signal, passive: true };
		window.addEventListener("scroll", () => this.schedule(), { ...options, capture: true });
		window.addEventListener("resize", () => this.schedule(), options);
		window.visualViewport?.addEventListener("resize", () => this.schedule(), options);
		window.visualViewport?.addEventListener("scroll", () => this.schedule(), options);
		closestComposed(host, "dialog:modal")?.addEventListener("close", onLost, options);
		this.#resize = new ResizeObserver(() => this.schedule());
		this.#resize.observe(host);
		this.#mutations = new MutationObserver((records) => {
			if (records.some((record) => !host.contains(record.target))) this.schedule();
		});
		for (const root of new Set([...selectionRoots(snapshot), host.getRootNode()])) {
			this.#mutations.observe(root, { childList: true, subtree: true, characterData: true,
				attributes: true, attributeFilter: ["class", "style", "hidden", "open", "aria-hidden"] });
		}
		this.schedule();
	}

	schedule() {
		this.#frame ??= requestAnimationFrame(() => {
			this.#frame = null;
			this.update();
		});
	}

	update() {
		if (!this.host.isConnected || !selectionConnected(this.snapshot)) {
			this.onLost();
			return;
		}
		const viewport = window.visualViewport;
		const width = viewport?.width ?? window.innerWidth;
		const height = viewport?.height ?? window.innerHeight;
		const left = viewport?.offsetLeft ?? 0;
		const top = viewport?.offsetTop ?? 0;
		this.#set("--bt-selection-width", Math.max(0, Math.min(400, width - 24)));
		this.#set("--bt-selection-height", Math.max(0, height - 24));
		const rectangle = selectionRectangle(this.snapshot);
		if (this.snapshot.range && !rectangle) {
			this.onLost();
			return;
		}
		if (!this.panel && rectangle && (rectangle.bottom < top || rectangle.top > top + height ||
			rectangle.right < left || rectangle.left > left + width)) {
			this.onLost();
			return;
		}
		const box = this.host.getBoundingClientRect();
		const anchor = rectangle ?? { left: left + (width - box.width) / 2, top: top + 60, bottom: top + 60 };
		const x = clamp(anchor.left, left + 12, left + width - box.width - 12);
		const below = anchor.bottom + 10;
		const above = anchor.top - box.height - 10;
		const y = clamp(below + box.height <= top + height - 12 ? below : above, top + 12, top + height - box.height - 12);
		// :host 中的 !important 优先于外部 style；由内部规则消费这些坐标变量。
		this.#set("--bt-selection-left", x);
		this.#set("--bt-selection-top", y);
		if (this.host.style.getPropertyValue("--bt-selection-visibility") !== "visible") {
			this.host.style.setProperty("--bt-selection-visibility", "visible", "important");
		}
	}

	dispose() {
		this.#listeners.abort();
		this.#resize?.disconnect();
		this.#mutations?.disconnect();
		if (this.#frame !== null) cancelAnimationFrame(this.#frame);
		this.#frame = null;
	}

	#set(name, value) {
		const pixels = `${value}px`;
		if (this.host.style.getPropertyValue(name) !== pixels) this.host.style.setProperty(name, pixels, "important");
	}
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

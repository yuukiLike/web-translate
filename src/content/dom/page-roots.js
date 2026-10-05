import translationCss from "../../../chrome-extension/content/content.css";
import { isOwnedNode } from "./node-utils.js";

/** 一个页面的 DOM 与开放 ShadowRoot 共用样式、发现和停止清理。 */
export class PageRoots {
	#roots = new Set();
	#observer = null;
	#slotListeners = new Map();
	#sheet = null;
	#pendingHosts = new Set();
	#timer = null;
	#active = false;

	constructor({ onRoot, onRemoved, onActivity }) {
		Object.assign(this, { onRoot, onRemoved, onActivity });
	}

	get roots() {
		return [...this.#roots];
	}

	start(dynamic) {
		this.#active = true;
		this.#sheet = new CSSStyleSheet();
		this.#sheet.replaceSync(translationCss);
		if (dynamic) {
			this.#observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					for (const node of mutation.addedNodes) this.discover(node);
				}
				this.#prune();
			});
			this.#observer.observe(document.documentElement, { childList: true, subtree: true });
			// Web Components 可能在插入后才升级并创建 ShadowRoot。
			this.#timer = setInterval(() => this.#discoverUpgradedHosts(), 1_500);
		}
		this.#addRoot(document.body);
		this.discover(document.body);
	}

	discover(node) {
		if (!this.#active || !node || isOwnedNode(node)) return;
		if (node === document.body) this.#addRoot(node);
		if (node.nodeType === Node.ELEMENT_NODE) this.#discoverHost(node);
		if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(node.nodeType)) return;
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, {
			acceptNode: (element) => isOwnedNode(element)
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT,
		});
		for (let element = walker.nextNode(); element; element = walker.nextNode()) {
			this.#discoverHost(element);
		}
	}

	stop() {
		this.#active = false;
		this.#observer?.disconnect();
		this.#observer = null;
		for (const listener of this.#slotListeners.values()) listener.abort();
		this.#slotListeners.clear();
		clearInterval(this.#timer);
		this.#timer = null;
		this.#pendingHosts.clear();
		for (const root of this.#roots) {
			if (root.host) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => sheet !== this.#sheet);
		}
		this.#roots.clear();
		this.#sheet = null;
	}

	#discoverHost(host) {
		if (host.shadowRoot) {
			this.#pendingHosts.delete(host);
			if (this.#addRoot(host.shadowRoot)) this.discover(host.shadowRoot);
		} else if (this.#observer && host.localName.includes("-")) {
			this.#pendingHosts.add(host);
		}
	}

	#addRoot(root) {
		if (!root || this.#roots.has(root)) return false;
		this.#roots.add(root);
		if (root.host) root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.#sheet];
		if (root.host) this.#observer?.observe(root, { childList: true, subtree: true });
		if (this.#observer) {
			const listener = new AbortController();
			this.#slotListeners.set(root, listener);
			root.addEventListener("slotchange", () => this.onActivity(root), { signal: listener.signal });
		}
		this.onRoot(root);
		if (this.#observer) this.onActivity();
		return true;
	}

	#discoverUpgradedHosts() {
		if (document.hidden) return;
		let changed = false;
		for (const host of this.#pendingHosts) {
			if (!host.isConnected) this.#pendingHosts.delete(host);
			else if (host.shadowRoot) {
				this.#discoverHost(host);
				changed = true;
			}
		}
		if (changed) this.onActivity();
	}

	#prune() {
		let removed = false;
		for (const root of this.#roots) {
			if (root.isConnected) continue;
			this.onRemoved(root);
			this.#slotListeners.get(root)?.abort();
			this.#slotListeners.delete(root);
			if (root.host) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => sheet !== this.#sheet);
			this.#roots.delete(root);
			removed = true;
		}
		if (!removed || !this.#observer) return;
		this.#observer.disconnect();
		this.#observer.observe(document.documentElement, { childList: true, subtree: true });
		for (const root of this.#roots) {
			if (root.host) this.#observer.observe(root, { childList: true, subtree: true });
		}
	}
}

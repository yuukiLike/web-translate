import { TIMING } from "../constants.js";
import { forEachTextNode, isOwnedNode } from "./node-utils.js";

/** 把 MutationObserver 事件归一化为“失效元素 + 待扫描根节点”。 */
export class MutationMonitor {
	#observer = null;
	#mutationTimer = null;

	constructor({
		runId,
		isCurrent,
		elementStore,
		scanner,
		invalidator,
		rootQueue,
		visibilityMonitor,
		onScan,
		onActivity,
		onError,
	}) {
		this.runId = runId;
		this.isCurrent = isCurrent;
		this.elementStore = elementStore;
		this.scanner = scanner;
		this.invalidator = invalidator;
		this.rootQueue = rootQueue;
		this.visibilityMonitor = visibilityMonitor;
		this.onScan = onScan;
		this.onActivity = onActivity;
		this.onError = onError;
	}

	start() {
		this.#observer?.disconnect();
		this.#observer = new MutationObserver((mutations) => {
			if (!this.isCurrent()) {
				return;
			}
			let relevant = false;
			for (const mutation of mutations) {
				relevant = this.#handleMutation(mutation) || relevant;
			}
			if (relevant) {
				this.onActivity();
				this.scheduleScan();
			}
		});
		this.#observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["class", "hidden", "lang", "style"],
			characterData: true,
			childList: true,
			subtree: true,
		});
	}

	scheduleScan() {
		if (!this.isCurrent() || this.#mutationTimer !== null) {
			return;
		}
		this.#mutationTimer = setTimeout(() => {
			this.#mutationTimer = null;
			void this.onScan().catch(this.onError);
		}, TIMING.mutationDebounce);
	}

	stop() {
		this.#observer?.disconnect();
		this.#observer = null;
		if (this.#mutationTimer !== null) {
			clearTimeout(this.#mutationTimer);
			this.#mutationTimer = null;
		}
		this.visibilityMonitor.stop();
	}

	#handleMutation(mutation) {
		if (mutation.type === "attributes") {
			return this.#handleAttributeMutation(mutation);
		}
		if (mutation.type === "characterData") {
			return this.#handleTextMutation(mutation);
		}
		return this.#handleChildListMutation(mutation);
	}

	#handleAttributeMutation(mutation) {
		if (isOwnedNode(mutation.target)) {
			return false;
		}
		if (mutation.attributeName === "class" || mutation.attributeName === "style") {
			this.onActivity();
			this.visibilityMonitor.queue(mutation.target);
			this.visibilityMonitor.schedule();
			return false;
		}
		if (mutation.attributeName === "hidden") {
			this.invalidator.invalidateTrackedSubtree(mutation.target);
		}
		this.rootQueue.add(mutation.target);
		return true;
	}

	#handleTextMutation(mutation) {
		if (isOwnedNode(mutation.target)) {
			return false;
		}
		const tracked =
			this.elementStore.getTextOwner(mutation.target) ??
			this.elementStore.findTrackedAncestor(mutation.target);
		if (tracked) {
			this.invalidator.invalidate(tracked);
			this.rootQueue.add(tracked);
		} else {
			this.rootQueue.add(mutation.target);
		}
		return true;
	}

	#handleChildListMutation(mutation) {
		const addedNodes = [...mutation.addedNodes].filter((node) => !isOwnedNode(node));
		const removedNodes = [...mutation.removedNodes];
		if (addedNodes.length === 0 && removedNodes.length === 0) {
			return false;
		}

		const affectedElements = new Set();
		const styleCache = new WeakMap();
		let shouldScan = false;
		for (const node of removedNodes) {
			if (isOwnedNode(node)) {
				shouldScan = this.invalidator.recoverRemovedTranslation(node) || shouldScan;
				continue;
			}
			forEachTextNode(node, (textNode) => {
				const owner = this.elementStore.getTextOwner(textNode);
				if (owner) {
					affectedElements.add(owner);
				}
			});
			this.invalidator.cleanupRemovedSubtree(node);
		}
		for (const node of addedNodes) {
			forEachTextNode(node, (textNode) => {
				const candidate = this.scanner.findContentUnit(textNode.parentElement, styleCache);
				if (candidate && this.elementStore.hasState(candidate)) {
					affectedElements.add(candidate);
				}
			});
			this.rootQueue.add(node);
			shouldScan = true;
		}
		for (const element of affectedElements) {
			this.invalidator.invalidate(element);
			if (element.isConnected) {
				this.rootQueue.add(element);
				shouldScan = true;
			}
		}
		return shouldScan;
	}
}

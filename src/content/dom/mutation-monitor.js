import { TIMING } from "../constants.js";
import { SITE_PRESENTATION } from "../site-profile.js";
import {
	isGeneratedPresentationIntact,
	restoreGeneratedPresentation,
} from "./generated-presentation.js";
import { transferGeneratedReplacements } from "./generated-replacement-transfer.js";
import { forEachTextNode, isOwnedNode } from "./node-utils.js";

const GENERATED_ATTRIBUTES = new Set([
	"aria-describedby",
	"data-bt-description-id",
	"data-bt-generated-owned",
	"data-bt-presentation",
	"data-bt-presentation-run",
	"data-bt-source",
	"data-bt-translation",
	"data-bt-translation-lang",
]);

/** 把 MutationObserver 事件归一化为“失效元素 + 待扫描根节点”。 */
export class MutationMonitor {
	#observer = null;
	#mutationTimer = null;
	#pendingGeneratedSources = new Set();

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
			let relevant = transferGeneratedReplacements({
				mutations,
				elementStore: this.elementStore,
				scanner: this.scanner,
				runId: this.runId,
				rootQueue: this.rootQueue,
			});
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
			attributeFilter: [
				"aria-describedby",
				"class",
				"data-bt-description-id",
				"data-bt-generated-owned",
				"data-bt-presentation",
				"data-bt-presentation-run",
				"data-bt-source",
				"data-bt-translation",
				"data-bt-translation-lang",
				"hidden",
				"lang",
				"role",
				"style",
			],
			characterData: true,
			childList: true,
			subtree: true,
		});
	}

	scheduleScan() {
		if (!this.isCurrent()) {
			return;
		}
		if (this.#mutationTimer !== null) {
			clearTimeout(this.#mutationTimer);
		}
		this.#mutationTimer = setTimeout(() => {
			this.#mutationTimer = null;
			this.#reconcileGeneratedSources();
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
		for (const source of [...this.elementStore.generatedSources]) {
			this.invalidator.invalidate(source);
		}
		this.#pendingGeneratedSources.clear();
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
		if (GENERATED_ATTRIBUTES.has(mutation.attributeName)) {
			this.#restoreGeneratedAttributes(mutation.target);
			return false;
		}
		if (mutation.attributeName === "class" || mutation.attributeName === "style") {
			this.onActivity();
			this.visibilityMonitor.queue(mutation.target);
			this.visibilityMonitor.schedule();
			return false;
		}
		if (mutation.attributeName === "hidden" || mutation.attributeName === "role") {
			this.invalidator.invalidateTrackedSubtree(
				mutation.target,
				true,
				(source) => !this.#queueGeneratedSource(source),
			);
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
			if (!this.#queueGeneratedSource(tracked)) {
				this.invalidator.invalidate(tracked);
				this.rootQueue.add(tracked);
			}
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
					if (this.#queueGeneratedSource(owner)) {
						shouldScan = true;
					} else {
						affectedElements.add(owner);
					}
				}
			});
			this.invalidator.cleanupRemovedSubtree(node, (source) => {
				if (!this.#queueGeneratedSource(source)) {
					return true;
				}
				shouldScan = true;
				return false;
			});
		}
		for (const node of addedNodes) {
			forEachTextNode(node, (textNode) => {
				const candidate = this.scanner.findContentUnit(textNode.parentElement, styleCache);
				if (
					candidate &&
					this.elementStore.hasState(candidate) &&
					!this.#queueGeneratedSource(candidate)
				) {
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

	#queueGeneratedSource(source) {
		const state = this.elementStore.getState(source);
		if (state?.presentation !== SITE_PRESENTATION.generated) {
			return false;
		}
		this.#pendingGeneratedSources.add(source);
		if (source.isConnected) {
			this.rootQueue.add(source);
		}
		return true;
	}

	#reconcileGeneratedSources() {
		for (const source of this.#pendingGeneratedSources) {
			const state = this.elementStore.getState(source);
			if (state?.presentation !== SITE_PRESENTATION.generated) {
				continue;
			}
			if (!source.isConnected) {
				this.invalidator.invalidate(source);
				continue;
			}
			if (!this.scanner.matchesCurrentCandidate(source, state.originalHash)) {
				this.invalidator.invalidate(source);
			}
			this.rootQueue.add(source);
		}
		this.#pendingGeneratedSources.clear();
	}

	#restoreGeneratedAttributes(source) {
		const state = this.elementStore.getState(source);
		if (state?.presentation !== SITE_PRESENTATION.generated) {
			return;
		}
		if (isGeneratedPresentationIntact(source, state.translationNode, this.runId)) {
			return;
		}
		restoreGeneratedPresentation(source, state.translationNode, this.runId);
	}
}

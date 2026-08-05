import { TRANSLATION_NODE_SELECTOR } from "../constants.js";
import { sourceSelector } from "./node-utils.js";

/** 统一清理过期元素状态，避免各类 Mutation 各自删一半状态。 */
export class ElementInvalidator {
	constructor({ elementStore, progress, rootQueue, getRunId }) {
		this.elementStore = elementStore;
		this.progress = progress;
		this.rootQueue = rootQueue;
		this.getRunId = getRunId;
	}

	invalidate(element) {
		this.elementStore.deferredElements.delete(element);
		const elementState = this.elementStore.getState(element);
		this.progress.cancelPending(element, elementState?.progressKey);

		if (elementState?.translationNode) {
			const translation = elementState.translationNode;
			elementState.translationNode = null;
			elementState.status = "invalidated";
			translation.remove();
		}
		this.elementStore.deleteState(element);
		if (element.dataset.btSource === this.getRunId()) {
			delete element.dataset.btSource;
		}
	}

	invalidateTrackedSubtree(root, includeAncestor = true) {
		const elements = new Set();
		const runId = this.getRunId();
		if (includeAncestor) {
			const trackedAncestor = this.elementStore.findTrackedAncestor(root);
			if (trackedAncestor) {
				elements.add(trackedAncestor);
			}
		}
		if (root.dataset?.btSource === runId) {
			elements.add(root);
		}
		for (const source of root.querySelectorAll?.(sourceSelector(runId)) ?? []) {
			elements.add(source);
		}
		for (const element of elements) {
			this.invalidate(element);
		}
	}

	recoverRemovedTranslation(node) {
		const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		const translations = [];
		if (element?.matches?.(TRANSLATION_NODE_SELECTOR)) {
			translations.push(element);
		}
		translations.push(...(element?.querySelectorAll?.(TRANSLATION_NODE_SELECTOR) ?? []));

		let recovered = false;
		for (const translation of translations) {
			const source = this.elementStore.getTranslationSource(translation);
			const elementState = source ? this.elementStore.getState(source) : null;
			if (source?.isConnected && elementState?.translationNode === translation) {
				this.invalidate(source);
				this.rootQueue.add(source);
				recovered = true;
			}
		}
		return recovered;
	}

	cleanupRemovedSubtree(node) {
		const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		if (!element) {
			return;
		}
		for (const deferred of [...this.elementStore.deferredElements]) {
			if (deferred === element || element.contains(deferred)) {
				this.elementStore.deferredElements.delete(deferred);
			}
		}

		const runId = this.getRunId();
		const sources = [];
		if (element.dataset?.btSource === runId) {
			sources.push(element);
		}
		sources.push(...(element.querySelectorAll?.(sourceSelector(runId)) ?? []));
		for (const source of sources) {
			this.invalidate(source);
		}
	}
}

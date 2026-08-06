import { TIMING } from "../constants.js";
import { sourceSelector } from "./node-utils.js";

/** 延迟处理 class/style 引起的布局与可见性变化。 */
export class VisibilityMonitor {
	#targets = new Set();
	#timer = null;

	constructor({
		runId,
		isCurrent,
		elementStore,
		layout,
		renderer,
		invalidator,
		rootQueue,
		onScan,
		onError,
	}) {
		this.runId = runId;
		this.isCurrent = isCurrent;
		this.elementStore = elementStore;
		this.layout = layout;
		this.renderer = renderer;
		this.invalidator = invalidator;
		this.rootQueue = rootQueue;
		this.onScan = onScan;
		this.onError = onError;
	}

	get size() {
		return this.#targets.size;
	}

	queue(element) {
		if (!element?.isConnected) {
			return;
		}
		for (const queued of this.#targets) {
			if (queued === element || queued.contains(element)) {
				return;
			}
			if (element.contains(queued)) {
				this.#targets.delete(queued);
			}
		}
		this.#targets.add(element);
	}

	schedule() {
		if (!this.isCurrent() || this.#timer !== null) {
			return;
		}
		this.#timer = setTimeout(() => {
			this.#timer = null;
			this.#sweep();
		}, TIMING.visibilityDebounce);
	}

	stop() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		this.#targets.clear();
	}

	#sweep() {
		if (!this.isCurrent()) {
			return;
		}
		const targets = [...this.#targets].filter((element) => element?.isConnected);
		this.#targets.clear();
		const { trackedElements, layoutRoots } = this.#collectAffectedElements(targets);
		this.#invalidateChangedLayouts(layoutRoots);
		this.#reconcileTrackedVisibility(trackedElements);
		this.#restoreDeferredElements(targets);
		// 即使布局未改变，也要让被 DOM 活动取消的完成状态重新收敛。
		void this.onScan().catch(this.onError);
	}

	#collectAffectedElements(targets) {
		const trackedElements = new Set();
		const layoutRoots = new Set();
		for (const element of targets) {
			const trackedAncestor = this.elementStore.findTrackedAncestor(element);
			if (this.layout.update(element)) {
				layoutRoots.add(element);
			}
			if (element.dataset?.btSource === this.runId) {
				trackedElements.add(element);
			}
			for (const source of element.querySelectorAll?.(sourceSelector(this.runId)) ?? []) {
				trackedElements.add(source);
			}
			if (trackedAncestor) {
				trackedElements.add(trackedAncestor);
			}
		}
		for (const element of trackedElements) {
			if (this.layout.update(element)) {
				layoutRoots.add(element);
			}
			if (element.parentElement && this.layout.update(element.parentElement)) {
				layoutRoots.add(element.parentElement);
			}
		}
		return { trackedElements, layoutRoots };
	}

	#invalidateChangedLayouts(layoutRoots) {
		let invalidated = false;
		for (const element of layoutRoots) {
			const hasTrackedDescendant = Boolean(
				element.dataset?.btSource === this.runId ||
					element.querySelector?.(sourceSelector(this.runId)),
			);
			const scanRoot = hasTrackedDescendant
				? element
				: this.elementStore.findTrackedAncestor(element) ?? element;
			this.invalidator.invalidateTrackedSubtree(element, !hasTrackedDescendant);
			this.rootQueue.add(scanRoot);
			invalidated = true;
		}
		return invalidated;
	}

	#reconcileTrackedVisibility(trackedElements) {
		for (const element of trackedElements) {
			const elementState = this.elementStore.getState(element);
			if (!this.layout.isEligible(element)) {
				this.invalidator.invalidate(element);
				this.elementStore.deferredElements.add(element);
			} else if (elementState?.translationNode) {
				this.renderer.copySourcePresentation(element, elementState.translationNode);
			}
		}
	}

	#restoreDeferredElements(targets) {
		let restored = false;
		for (const element of [...this.elementStore.deferredElements]) {
			if (!element.isConnected) {
				this.elementStore.deferredElements.delete(element);
				continue;
			}
			const affected =
				targets.length === 0 ||
				targets.some(
					(target) =>
						target === element || target.contains(element) || element.contains(target),
				);
			if (affected && this.layout.isEligible(element)) {
				this.elementStore.deferredElements.delete(element);
				this.rootQueue.add(element);
				restored = true;
			}
		}
		return restored;
	}
}

import { TIMING } from "../constants.js";
import { SITE_PRESENTATION } from "../site-profile.js";
import { sourceSelector } from "./node-utils.js";

/** 延迟处理 class/style 引起的布局与可见性变化。 */
export class VisibilityMonitor {
	#targets = new Set();
	#blockingTargets = new Set();
	#knownLayoutChanges = new Set();
	#timer = null;
	#blockingTimer = null;

	constructor({
		runId,
		isCurrent,
		elementStore,
		layout,
		renderer,
		invalidator,
		rootQueue,
		onScan,
		onActivity = () => {},
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
		this.onActivity = onActivity;
		this.onError = onError;
	}

	get size() {
		return this.#targets.size + this.#blockingTargets.size;
	}

	get hasBlockingWork() {
		return this.#blockingTargets.size > 0;
	}

	queue(element) {
		if (!element?.isConnected) {
			return;
		}
		const layoutChanged = this.layout.update(element);
		if (layoutChanged) {
			this.#knownLayoutChanges.add(element);
		}
		const blocksCompletion =
			this.#hasRestoredDeferredElement(element) ||
			this.#hasHiddenTrackedElement(element);
		if (blocksCompletion) {
			if (this.#addTarget(this.#blockingTargets, element)) {
				this.onActivity();
			}
			this.#removeCoveredTargets(element);
			return;
		}
		if (!this.#isCoveredByBlockingTarget(element)) {
			this.#addTarget(this.#targets, element);
		}
	}

	#addTarget(targets, element) {
		for (const queued of targets) {
			if (queued === element || queued.contains(element)) {
				return false;
			}
			if (element.contains(queued)) {
				targets.delete(queued);
			}
		}
		targets.add(element);
		return true;
	}

	schedule() {
		if (!this.isCurrent()) {
			return;
		}
		if (this.#blockingTargets.size > 0 && this.#blockingTimer === null) {
			this.#blockingTimer = setTimeout(() => {
				this.#blockingTimer = null;
				this.#sweep(this.#takeBlockingTargets());
			}, TIMING.visibilityDebounce);
		}
		if (this.#targets.size > 0) {
			if (this.#timer !== null) {
				clearTimeout(this.#timer);
			}
			this.#timer = setTimeout(() => {
				this.#timer = null;
				this.#sweep(this.#takeTargets());
			}, TIMING.visibilityDebounce);
		}
	}

	stop() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		if (this.#blockingTimer !== null) {
			clearTimeout(this.#blockingTimer);
			this.#blockingTimer = null;
		}
		this.#targets.clear();
		this.#blockingTargets.clear();
		this.#knownLayoutChanges.clear();
	}

	#sweep({ targets, layoutRoots }) {
		if (!this.isCurrent()) {
			return;
		}
		const connectedTargets = targets.filter((element) => element?.isConnected);
		const affected = this.#collectAffectedElements(connectedTargets, layoutRoots);
		this.#invalidateChangedLayouts(affected.layoutRoots);
		this.#reconcileTrackedVisibility(affected.trackedElements);
		this.#restoreDeferredElements(connectedTargets);
		// 即使布局未改变，也要让被 DOM 活动取消的完成状态重新收敛。
		void this.onScan().catch(this.onError);
	}

	#collectAffectedElements(targets, knownLayoutRoots) {
		const trackedElements = this.#findTrackedElements(targets);
		const layoutRoots = new Set(knownLayoutRoots);
		for (const element of targets) {
			if (this.layout.update(element)) {
				layoutRoots.add(element);
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

	#findTrackedElements(targets) {
		const trackedElements = new Set();
		for (const element of targets) {
			const trackedAncestor = this.elementStore.findTrackedAncestor(element);
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
		return trackedElements;
	}

	#hasRestoredDeferredElement(target) {
		for (const element of this.elementStore.deferredElements) {
			const related =
				target === element || target.contains(element) || element.contains(target);
			if (related && this.layout.isEligible(element)) {
				return true;
			}
		}
		return false;
	}

	#hasHiddenTrackedElement(target) {
		const trackedElements = this.#findTrackedElements([target]);
		if (trackedElements.size === 0) {
			return false;
		}
		if (!this.layout.isEligible(target)) {
			return true;
		}
		for (const element of trackedElements) {
			if (!this.layout.isEligible(element)) {
				return true;
			}
		}
		return false;
	}

	#removeCoveredTargets(blockingTarget) {
		for (const target of this.#targets) {
			if (blockingTarget === target || blockingTarget.contains(target)) {
				this.#targets.delete(target);
			}
		}
	}

	#isCoveredByBlockingTarget(element) {
		for (const target of this.#blockingTargets) {
			if (target === element || target.contains(element)) {
				return true;
			}
		}
		return false;
	}

	#takeBlockingTargets() {
		return this.#takeTargetsFrom(this.#blockingTargets);
	}

	#takeTargets() {
		return this.#takeTargetsFrom(this.#targets);
	}

	#takeTargetsFrom(targetSet) {
		const targets = [...targetSet];
		targetSet.clear();
		const layoutRoots = new Set();
		for (const element of this.#knownLayoutChanges) {
			const related = targets.some(
				(target) =>
					target === element || target.contains(element) || element.contains(target),
			);
			if (related) {
				layoutRoots.add(element);
				this.#knownLayoutChanges.delete(element);
			}
		}
		return { targets, layoutRoots };
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
			this.invalidator.invalidateTrackedSubtree(
				element,
				!hasTrackedDescendant,
				(source) =>
					this.elementStore.getState(source)?.presentation !==
					SITE_PRESENTATION.generated,
			);
			this.rootQueue.add(scanRoot);
			invalidated = true;
		}
		return invalidated;
	}

	#reconcileTrackedVisibility(trackedElements) {
		for (const element of trackedElements) {
			const elementState = this.elementStore.getState(element);
			if (!this.layout.isEligible(element)) {
				if (elementState?.presentation === SITE_PRESENTATION.generated) {
					continue;
				}
				this.invalidator.invalidate(element);
				this.elementStore.deferredElements.add(element);
			} else if (
				elementState?.translationNode &&
				elementState.presentation !== SITE_PRESENTATION.generated
			) {
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

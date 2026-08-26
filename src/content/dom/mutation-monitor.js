import { findSiteProfileMutationRoot } from "../site-profile.js";
import { GeneratedMutationReconciler } from "./generated-mutation-reconciler.js";
import { transferGeneratedReplacements } from "./generated-replacement-transfer.js";
import { MutationScanQueue } from "./mutation-scan-queue.js";
import { forEachTextNode, isOwnedNode } from "./node-utils.js";
import { VolatileMutationFilter } from "./volatile-mutation-filter.js";

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

const OBSERVED_ATTRIBUTES = [
	...GENERATED_ATTRIBUTES,
	"aria-hidden",
	"aria-label",
	"class",
	"data-hovercard-type",
	"hidden",
	"inert",
	"lang",
	"role",
	"style",
];

function getObservedAttributes(hostname) {
	return hostname === "github.com" ? [...OBSERVED_ATTRIBUTES, "href"] : OBSERVED_ATTRIBUTES;
}

/** 把 MutationObserver 事件归一化为“失效元素 + 待扫描根节点”。 */
export class MutationMonitor {
	#observer = null;

	constructor({
		runId,
		isCurrent,
		elementStore,
		scanner,
		invalidator,
		rootQueue,
		progress,
		volatilityTracker,
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
		this.visibilityMonitor = visibilityMonitor;
		this.progress = progress;
		this.onActivity = onActivity;
		this.scanQueue = new MutationScanQueue({
			isCurrent,
			rootQueue,
			beforeFlush: () => this.generatedReconciler.reconcile(),
			onScan,
			onError,
		});
		this.generatedReconciler = new GeneratedMutationReconciler({
			runId,
			elementStore,
			scanner,
			invalidator,
			rootQueue: this.scanQueue,
		});
		this.volatileFilter = new VolatileMutationFilter({
			runId,
			tracker: volatilityTracker,
			elementStore,
			scanner,
			invalidator,
		});
	}

	get hasPendingWork() {
		return this.scanQueue.hasPendingWork;
	}

	start() {
		this.#observer?.disconnect();
		this.#observer = new MutationObserver((mutations) => {
			if (!this.isCurrent()) {
				return;
			}
			const { accepted, volatileRoots } = this.volatileFilter.filter(mutations);
			for (const root of volatileRoots) {
				this.scanQueue.add(root);
			}
			let relevant = transferGeneratedReplacements({
				mutations: accepted,
				elementStore: this.elementStore,
				progress: this.progress,
				scanner: this.scanner,
				runId: this.runId,
				rootQueue: this.scanQueue,
			}) || volatileRoots.size > 0;
			for (const mutation of accepted) {
				relevant = this.#handleMutation(mutation) || relevant;
			}
			if (relevant) {
				this.onActivity();
				this.scheduleScan();
			}
		});
		this.#observer.observe(document.body, {
			attributes: true,
			attributeOldValue: window.location.hostname === "github.com",
			attributeFilter: getObservedAttributes(window.location.hostname),
			characterData: true,
			characterDataOldValue: true,
			childList: true,
			subtree: true,
		});
	}

	scheduleScan() {
		this.scanQueue.schedule();
	}

	stop() {
		this.#observer?.disconnect();
		this.#observer = null;
		this.scanQueue.stop();
		this.visibilityMonitor.stop();
		for (const source of [...this.elementStore.generatedSources]) {
			this.invalidator.invalidate(source);
		}
		this.generatedReconciler.clear();
		this.volatileFilter.clear();
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
			this.generatedReconciler.restoreAttributes(mutation.target);
			return false;
		}
		const siteMutationRoot = findSiteProfileMutationRoot(mutation);
		if (mutation.attributeName === "class" || mutation.attributeName === "style") {
			this.visibilityMonitor.queue(mutation.target);
			this.visibilityMonitor.schedule();
			if (!siteMutationRoot) {
				return false;
			}
		}
		if (siteMutationRoot) {
			const trackedSource = this.elementStore.findTrackedAncestor(siteMutationRoot);
			this.invalidator.invalidateTrackedSubtree(siteMutationRoot, true);
			this.scanQueue.add(trackedSource ?? siteMutationRoot);
			return true;
		}
		if (mutation.attributeName === "href") {
			return false;
		}
		const trackedSource = this.elementStore.findTrackedAncestor(mutation.target);
		const scanRoot =
			trackedSource ?? this.scanner.findContentUnit(mutation.target) ?? mutation.target;
		if (mutation.attributeName === "aria-hidden" || mutation.attributeName === "inert") {
			if (this.scanner.isExcluded(mutation.target)) {
				this.invalidator.discardTrackedSubtree(mutation.target, true);
			} else {
				this.invalidator.invalidateTrackedSubtree(mutation.target, true);
			}
			this.scanQueue.add(scanRoot);
			return true;
		}
		if (mutation.attributeName === "hidden" || mutation.attributeName === "role") {
			this.invalidator.invalidateTrackedSubtree(
				mutation.target,
				true,
				(source) => !this.generatedReconciler.queue(source),
			);
		}
		this.scanQueue.add(scanRoot);
		return true;
	}

	#handleTextMutation(mutation) {
		if (
			isOwnedNode(mutation.target) ||
			this.scanner.isExcluded(mutation.target.parentElement)
		) {
			return false;
		}
		const tracked =
			this.elementStore.getTextOwner(mutation.target) ??
			this.elementStore.findTrackedAncestor(mutation.target);
		if (tracked) {
			if (!this.generatedReconciler.queue(tracked)) {
				this.invalidator.invalidate(tracked);
				this.scanQueue.add(tracked);
			}
		} else {
			this.scanQueue.add(mutation.target);
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
		const siteMutationRoot = findSiteProfileMutationRoot(mutation);
		if (!siteMutationRoot && this.scanner.isExcluded(mutation.target)) {
			return false;
		}
		let shouldScan = Boolean(siteMutationRoot);
		if (siteMutationRoot) {
			this.invalidator.invalidateTrackedSubtree(siteMutationRoot, true);
			this.scanQueue.add(siteMutationRoot);
		}
		for (const node of removedNodes) {
			if (isOwnedNode(node)) {
				shouldScan = this.invalidator.recoverRemovedTranslation(node) || shouldScan;
				continue;
			}
			forEachTextNode(node, (textNode) => {
				const owner = this.elementStore.getTextOwner(textNode);
				if (owner) {
					if (this.generatedReconciler.queue(owner)) {
						shouldScan = true;
					} else {
						affectedElements.add(owner);
					}
				}
			});
			this.invalidator.cleanupRemovedSubtree(node, (source) => {
				if (!this.generatedReconciler.queue(source)) {
					return true;
				}
				shouldScan = true;
				return false;
			});
		}
		for (const node of addedNodes) {
			let hasCandidate = false;
			forEachTextNode(node, (textNode) => {
				const candidate = this.scanner.findContentUnit(textNode.parentElement, styleCache);
				hasCandidate ||= Boolean(candidate);
				if (
					candidate &&
					this.elementStore.hasState(candidate) &&
					!this.generatedReconciler.queue(candidate)
				) {
					affectedElements.add(candidate);
				}
			});
			if (hasCandidate) {
				this.scanQueue.add(node);
				shouldScan = true;
			}
		}
		for (const element of affectedElements) {
			this.invalidator.invalidate(element);
			if (element.isConnected) {
				this.scanQueue.add(element);
				shouldScan = true;
			}
		}
		return shouldScan;
	}
}

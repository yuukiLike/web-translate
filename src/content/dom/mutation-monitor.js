import { getObservedAttributes, handleAttributeMutation } from "./mutation-attributes.js";
import { findSiteProfileMutationRoot } from "../site-profile.js";
import { GeneratedMutationReconciler } from "./generated-mutation-reconciler.js";
import { transferGeneratedReplacements } from "./generated-replacement-transfer.js";
import { MutationScanQueue } from "./mutation-scan-queue.js";
import { forEachTextNode, isOwnedNode, textParent } from "./node-utils.js";
import { VolatileMutationFilter } from "./volatile-mutation-filter.js";

/** 把 MutationObserver 事件归一化为“失效元素 + 待扫描根节点”。 */
export class MutationMonitor {
	#observer = null;
	#roots = new Set();

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
		this.#roots.clear();
		this.#observer = new MutationObserver((mutations) => this.#processMutations(mutations));
		this.observeRoot(document.body);
	}

	observeRoot(root) {
		if (!this.#observer || this.#roots.has(root)) return;
		this.#roots.add(root);
		this.#observer.observe(root, {
			attributes: true,
			attributeOldValue: window.location.hostname === "github.com",
			attributeFilter: getObservedAttributes(),
			characterData: true,
			characterDataOldValue: true,
			childList: true,
			subtree: true,
		});
	}

	removeRoot(root) {
		if (!this.#observer || !this.#roots.has(root)) return;
		const pending = this.#observer.takeRecords();
		this.#observer.disconnect();
		const remaining = [...this.#roots].filter((item) => item !== root && item.isConnected);
		this.#roots.clear();
		for (const item of remaining) this.observeRoot(item);
		if (pending.length) this.#processMutations(pending);
	}

	scheduleScan(root = null) {
		if (root) {
			this.scanQueue.add(root);
			this.onActivity();
		}
		this.scanQueue.schedule();
	}

	stop() {
		this.#observer?.disconnect();
		this.#observer = null;
		this.#roots.clear();
		this.scanQueue.stop();
		this.visibilityMonitor.stop();
		for (const source of [...this.elementStore.generatedSources]) {
			this.invalidator.invalidate(source);
		}
		this.generatedReconciler.clear();
		this.volatileFilter.clear();
	}

	#processMutations(mutations) {
		if (!this.isCurrent()) return;
		const { accepted, volatileRoots } = this.volatileFilter.filter(mutations);
		for (const root of volatileRoots) this.scanQueue.add(root);
		let relevant = transferGeneratedReplacements({
			mutations: accepted,
			elementStore: this.elementStore,
			progress: this.progress,
			scanner: this.scanner,
			runId: this.runId,
			rootQueue: this.scanQueue,
		}) || volatileRoots.size > 0;
		for (const mutation of accepted) relevant = this.#handleMutation(mutation) || relevant;
		if (relevant) {
			this.onActivity();
			this.scheduleScan();
		}
	}

	#handleMutation(mutation) {
		const trackedResult =
			this.generatedReconciler.handleTrackedTranslationMutation(mutation);
		if (trackedResult !== null) {
			return trackedResult;
		}
		if (mutation.type === "attributes") {
			return handleAttributeMutation(this, mutation);
		}
		if (mutation.type === "characterData") {
			return this.#handleTextMutation(mutation);
		}
		return this.#handleChildListMutation(mutation);
	}

	#handleTextMutation(mutation) {
		if (
			isOwnedNode(mutation.target) ||
			this.scanner.isExcluded(textParent(mutation.target))
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
		const siteMutationRoot = findSiteProfileMutationRoot(mutation);
		// target 被排除时，新增子树仍可能用 translate=yes 或正文根节点恢复资格。
		let shouldScan = Boolean(siteMutationRoot);
		if (siteMutationRoot) {
			this.invalidator.invalidateTrackedSubtree(siteMutationRoot, true);
			this.scanQueue.add(siteMutationRoot);
		}
		if ([...addedNodes, ...removedNodes].some(changesTextBoundary)) {
			const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.host;
			const source = this.elementStore.findTrackedAncestor(mutation.target) ?? this.scanner.findContentUnit(target);
			if (source) {
				if (!this.generatedReconciler.queue(source)) affectedElements.add(source);
				this.scanQueue.add(source);
				shouldScan = true;
			}
		}
		shouldScan = this.#handleRemovedNodes(removedNodes, affectedElements) || shouldScan;
		shouldScan = this.#collectAddedCandidates(addedNodes, affectedElements) || shouldScan;
		for (const element of affectedElements) {
			this.invalidator.invalidate(element);
			if (element.isConnected) {
				this.scanQueue.add(element);
				shouldScan = true;
			}
		}
		return shouldScan;
	}

	#handleRemovedNodes(nodes, affectedElements) {
		let shouldScan = false;
		for (const node of nodes) {
			const recovered = this.generatedReconciler.recoverRemovedTranslation(node);
			shouldScan = recovered || this.invalidator.recoverRemovedTranslation(node) || shouldScan;
			if (isOwnedNode(node)) {
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
		return shouldScan;
	}

	#collectAddedCandidates(nodes, affectedElements) {
		let shouldScan = false;
		const styleCache = new WeakMap();
		for (const node of nodes) {
			let hasCandidate = false;
			forEachTextNode(node, (textNode) => {
				const candidate = this.scanner.findContentUnit(textParent(textNode), styleCache);
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
		return shouldScan;
	}
}

function changesTextBoundary(node) {
	if (node.nodeType !== Node.ELEMENT_NODE || isOwnedNode(node)) return false;
	if (node.matches("br, slot")) return true;
	return [...node.querySelectorAll("br, slot")].some((boundary) => !isOwnedNode(boundary));
}

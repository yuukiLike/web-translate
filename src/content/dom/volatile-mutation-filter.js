import { matchCompleteGeneratedReplacements } from "./generated-replacement-transfer.js";
import {
	addTextFallback,
	collectContentRoots,
	getMutationElement,
	hasSameReplacementText,
	hasSameTextValue,
	meaningfulNodes,
	pairContentRoots,
	pairReplacementNodes,
} from "./mutation-content.js";
import { isOwnedNode } from "./node-utils.js";
import { groupClosedReplacementMutations } from "./replacement-batch.js";
import { ReplacementLineage } from "./replacement-lineage.js";
import { VolatilityRouteContext } from "./volatility-route-context.js";

const REPLACEMENT_PAIR_WINDOW_MS = 500;

/** 只拦截已确认的易变内容；同一父容器中的独立替换链互不累计。 */
export class VolatileMutationFilter {
	constructor({
		runId,
		tracker,
		elementStore,
		scanner,
		invalidator,
		clock = Date.now,
		getRouteKey,
		replacementPairWindowMs = REPLACEMENT_PAIR_WINDOW_MS,
	}) {
		this.runId = runId;
		this.tracker = tracker;
		this.elementStore = elementStore;
		this.scanner = scanner;
		this.invalidator = invalidator;
		this.collectContentRoots = (nodes) =>
			collectContentRoots(nodes, { elementStore, tracker, scanner });
		this.lineage = new ReplacementLineage({
			clock,
			pairWindowMs: replacementPairWindowMs,
		});
		this.routeContext = new VolatilityRouteContext({
			tracker,
			lineage: this.lineage,
			getRouteKey,
		});
	}
	filter(mutations) {
		this.routeContext.sync();
		const rejected = new Set();
		const volatileRoots = new Set();
		const batchAddedNodes = new Set(
			mutations.flatMap((mutation) =>
				mutation.type === "childList" ? meaningfulNodes(mutation.addedNodes) : [],
			),
		);
		const generatedTransfers = this.#findGeneratedTransfers(mutations);
		for (const { boundary, pairs } of generatedTransfers.groups) {
			this.lineage.linkCompleteReplacements(boundary, pairs);
		}
		for (const mutation of mutations) {
			this.#filterObservation(mutation, {
				batchAddedNodes,
				generatedTransferMutations: generatedTransfers.mutations,
				rejected,
				volatileRoots,
			});
		}

		const accepted = mutations.filter((mutation) => {
			if (rejected.has(mutation)) {
				return false;
			}
			const target = getMutationElement(mutation);
			if (!target || !this.tracker.isVolatile(target)) {
				return true;
			}
			this.#discardRemovedSources(mutation);
			return false;
		});
		return { accepted, volatileRoots };
	}

	clear() {
		this.lineage.clear();
	}

	#filterObservation(mutation, context) {
		const target = getMutationElement(mutation);
		if (!target) {
			return;
		}
		if (
			mutation.type === "childList" &&
			context.generatedTransferMutations.has(mutation)
		) {
			return;
		}
		if (this.tracker.isVolatile(target)) {
			this.#discardRemovedSources(mutation);
			context.rejected.add(mutation);
			return;
		}
		if (mutation.type === "characterData") {
			this.#filterTextChange(mutation, context);
			return;
		}
		if (mutation.type === "childList") {
			this.#filterChildListChange(mutation, context);
		}
	}

	#filterTextChange(mutation, context) {
		if (
			isOwnedNode(mutation.target) ||
			this.scanner.isExcluded(mutation.target.parentElement) ||
			hasSameTextValue(mutation)
		) {
			return;
		}
		const contentUnit =
			this.elementStore.getTextOwner(mutation.target) ??
			this.scanner.findContentUnit(mutation.target.parentElement);
		if (!contentUnit) {
			return;
		}
		const identity = this.lineage.identityFor(contentUnit);
		const result = this.tracker.recordChange(identity, [contentUnit]);
		this.#applyVolatility(identity, result, context);
	}

	#filterChildListChange(mutation, context) {
		const boundary = getMutationElement(mutation);
		if (!boundary || isOwnedNode(boundary) || this.scanner.isExcluded(boundary)) {
			return;
		}
		const removedNodes = meaningfulNodes(mutation.removedNodes);
		const addedNodes = meaningfulNodes(mutation.addedNodes);
		const directPairs = pairReplacementNodes(removedNodes, addedNodes);
		const observations = this.lineage.observe(mutation, {
			addedNodes,
			allowLiveReciprocal: (removedNode) =>
				!this.tracker.isActivityVolatile(this.lineage.identityFor(removedNode)),
			batchAddedNodes: context.batchAddedNodes,
			directPairs,
			removedNodes,
		});
		for (const observation of observations) {
			this.#filterReplacement(boundary, observation, context);
		}
	}

	#filterReplacement(boundary, observation, context) {
		const replacement = this.#collectReplacement(boundary, observation);
		if (replacement.removed.roots.size === 0 && replacement.added.roots.size === 0) {
			return;
		}
		const { pairs, unpairedRemoved } = pairContentRoots(
			replacement.removed,
			replacement.added,
		);
		this.#discardDisconnected(unpairedRemoved);
		for (const pair of pairs) {
			this.#filterContentPair(pair, observation, context, pairs.length === 1);
		}
	}

	#filterContentPair(replacement, observation, context, includeRawNodes) {
		const affected = [
			...new Set([...replacement.removed.roots, ...replacement.added.roots]),
		];
		const removedRoots = [...replacement.removed.roots];
		const identity = this.lineage.adopt(
			removedRoots[0]
				? this.lineage.identityFor(removedRoots[0])
				: observation.identity,
			removedRoots,
			[
				...replacement.added.roots,
				...(includeRawNodes ? observation.removedNodes : []),
				...(includeRawNodes ? observation.addedNodes : []),
			],
		);
		if (this.tracker.isActivityVolatile(identity)) {
			const result = this.tracker.recordChange(identity, affected);
			this.#applyVolatility(identity, result, context);
			return;
		}
		if (hasSameReplacementText(replacement)) {
			if (!this.#matchCompleteGeneratedTransfer(replacement)) {
				this.#discardDisconnected(replacement.removed.roots);
			}
			return;
		}

		this.#discardDisconnected(replacement.removed.roots);
		const result = this.tracker.recordChange(identity, affected);
		this.#applyVolatility(identity, result, context);
	}

	#collectReplacement(boundary, observation) {
		const removed = this.collectContentRoots(observation.removedNodes);
		const added = this.collectContentRoots(observation.addedNodes);
		const fallback = this.scanner.findContentUnit(boundary);
		if (fallback) {
			addTextFallback(removed, fallback);
			addTextFallback(added, fallback);
		}
		return { removed, added };
	}

	#matchCompleteGeneratedTransfer({ removed, added }) {
		return matchCompleteGeneratedReplacements({
			removedSources: [...removed.roots],
			addedCandidates: [...added.roots],
			elementStore: this.elementStore,
			runId: this.runId,
			scanner: this.scanner,
		});
	}

	#findGeneratedTransfers(mutations) {
		const transfers = { groups: [], mutations: new Set() };
		for (const group of groupClosedReplacementMutations(mutations)) {
			const boundary = group[0].target;
			const replacement = {
				added: this.collectContentRoots(
					group.flatMap((mutation) => meaningfulNodes(mutation.addedNodes)),
				),
				removed: this.collectContentRoots(
					group.flatMap((mutation) => meaningfulNodes(mutation.removedNodes)),
				),
			};
			const pairs = this.#matchCompleteGeneratedTransfer(replacement);
			if (pairs) {
				transfers.groups.push({ boundary, pairs });
				for (const mutation of group) {
					transfers.mutations.add(mutation);
				}
			}
		}
		return transfers;
	}

	#applyVolatility(identity, result, { volatileRoots }) {
		if (!this.tracker.isActivityVolatile(identity)) {
			return;
		}
		this.#discardAll(result.affectedElements);
		if (!result.becameVolatile) {
			return;
		}
		for (const root of result.affectedElements) {
			volatileRoots.add(root);
		}
	}

	#discardDisconnected(elements) {
		this.#discardAll([...elements].filter((element) => !element.isConnected));
	}

	#discardAll(elements) {
		for (const element of elements) {
			this.invalidator.discard(element);
		}
	}

	#discardRemovedSources(mutation) {
		if (mutation.type !== "childList") {
			return;
		}
		this.#discardAll(this.collectContentRoots(mutation.removedNodes).roots);
	}
}

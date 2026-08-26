import {
	createReplacementGap,
	findUniqueIndex,
	getLiveNeighbors,
	getMutationNodeSlot,
	hasSameReplacementGap,
	isReciprocalReplacement,
	mutationTouches,
} from "./replacement-gap.js";

/**
 * 为 fresh DOM 替换维护独立链身份。
 * 任一半边最多保留一个短配对窗口，避免连接父节点长期持有旧子树。
 */
export class ReplacementLineage {
	#identityByNode = new WeakMap();
	#pendingByBoundary = new WeakMap();
	#pendingBoundaries = new Set();

	constructor({ clock = Date.now, pairWindowMs = 500 } = {}) {
		this.clock = clock;
		this.pairWindowMs = pairWindowMs;
	}

	identityFor(node) {
		let identity = this.#identityByNode.get(node);
		if (!identity) {
			identity = {};
			this.#identityByNode.set(node, identity);
		}
		return identity;
	}

	adopt(fallbackIdentity, preferredNodes, linkedNodes = []) {
		const identity =
			preferredNodes
				.map((node) => this.#identityByNode.get(node))
				.find(Boolean) ??
			fallbackIdentity ??
			{};
		for (const node of [...preferredNodes, ...linkedNodes]) {
			this.#identityByNode.set(node, identity);
		}
		return identity;
	}

	observe(
		mutation,
		{
			removedNodes,
			addedNodes,
			directPairs,
			batchAddedNodes = new Set(),
			allowLiveReciprocal = () => true,
		},
	) {
		const direct = directPairs ?? pairNodesByIndex(removedNodes, addedNodes);
		const observations = [];
		const unpairedNodes = [
			...(direct.unpairedRemoved ?? []),
			...(direct.unpairedAdded ?? []),
		];
		this.#removePendingNodes(
			mutation.target,
			[
				...direct.pairs.flatMap(({ removedNode, addedNode }) => [removedNode, addedNode]),
				...unpairedNodes,
			],
		);
		for (const node of unpairedNodes) {
			this.identityFor(node);
		}
		for (const { removedNode, addedNode } of direct.pairs) {
			observations.push(this.#link(removedNode, addedNode));
		}

		observations.push(
			...this.#observeHalf(
				mutation,
				direct.remainingRemoved,
				"removals",
				0,
				direct.remainingRemoved.length,
				batchAddedNodes,
				allowLiveReciprocal,
			),
			...this.#observeHalf(
				mutation,
				direct.remainingAdded,
				"additions",
				0,
				direct.remainingAdded.length,
				batchAddedNodes,
				allowLiveReciprocal,
			),
		);
		return observations;
	}

	linkCompleteReplacements(boundary, pairs) {
		const linkedNodes = new Set(
			pairs.flatMap(({ source, target }) => [source, target]),
		);
		this.#removePendingNodes(boundary, linkedNodes);
		return pairs.map(({ source, target }) => this.#link(source, target));
	}

	clear() {
		for (const boundary of this.#pendingBoundaries) {
			this.#deletePending(boundary);
		}
		this.#pendingBoundaries.clear();
	}

	reset() {
		this.clear();
		this.#identityByNode = new WeakMap();
	}

	#link(removedNode, addedNode) {
		const identity =
			[this.#identityByNode.get(removedNode), this.#identityByNode.get(addedNode)]
				.find(Boolean) ?? {};
		this.#identityByNode.set(removedNode, identity);
		this.#identityByNode.set(addedNode, identity);
		return { identity, removedNodes: [removedNode], addedNodes: [addedNode] };
	}

	#observeHalf(
		mutation,
		nodes,
		kind,
		offset,
		nodeCount,
		batchAddedNodes,
		allowLiveReciprocal,
	) {
		if (nodes.length === 0) {
			return [];
		}
		const boundary = mutation.target;
		const pending = this.#getFreshPending(boundary);
		const oppositeKind = kind === "removals" ? "additions" : "removals";
		const observations = [];
		for (const [index, node] of nodes.entries()) {
			const gap = createReplacementGap(mutation, offset + index, nodeCount);
			const slot = getMutationNodeSlot(mutation, node, kind, offset + index);
			const opposite = pending[oppositeKind];
			if (kind === "removals") {
				const earlierAddition = opposite.findIndex((item) => item.node === node);
				if (earlierAddition >= 0) {
					opposite.splice(earlierAddition, 1);
				}
			}
			const batchAdjacentAddition = kind === "removals"
				? findUniqueIndex(opposite, (item) =>
					batchAddedNodes.has(item.node) && mutationTouches(mutation, item.node),
				)
				: -1;
			const reciprocalAddition = kind === "removals"
				? findUniqueIndex(opposite, (item) =>
					isReciprocalReplacement(
						item,
						mutation,
						node,
						allowLiveReciprocal(node),
					),
				)
				: -1;
			const gapMatch = findUniqueIndex(opposite, (item) =>
				hasSameReplacementGap(item.gap, gap),
			);
			const slotMatch = findUniqueIndex(opposite, (item) => item.slot === slot);
			const matchIndex = [
				batchAdjacentAddition,
				reciprocalAddition,
				gapMatch,
				slotMatch,
			].find((candidate) => candidate >= 0) ?? -1;
			if (matchIndex < 0) {
				this.identityFor(node);
				pending[kind].push({
					gap,
					liveNeighbors: getLiveNeighbors(boundary, node),
					node,
					observedAt: this.clock(),
					slot,
				});
				continue;
			}
			const [match] = opposite.splice(matchIndex, 1);
			observations.push(
				kind === "removals"
					? this.#link(node, match.node)
					: this.#link(match.node, node),
			);
		}
		this.#finishPendingUpdate(boundary, pending);
		return observations;
	}

	#removePendingNodes(boundary, nodes) {
		const pending = this.#pendingByBoundary.get(boundary);
		if (!pending || nodes.length === 0) {
			return;
		}
		const removed = new Set(nodes);
		pending.additions = pending.additions.filter(({ node }) => !removed.has(node));
		pending.removals = pending.removals.filter(({ node }) => !removed.has(node));
		this.#finishPendingUpdate(boundary, pending);
	}

	#getFreshPending(boundary) {
		let pending = this.#pendingByBoundary.get(boundary);
		if (!pending) {
			pending = { additions: [], removals: [], timer: null };
			this.#pendingByBoundary.set(boundary, pending);
			this.#pendingBoundaries.add(boundary);
			return pending;
		}
		this.#pruneExpired(pending);
		return pending;
	}

	#finishPendingUpdate(boundary, pending) {
		this.#pruneExpired(pending);
		if (pending.additions.length === 0 && pending.removals.length === 0) {
			this.#deletePending(boundary);
			return;
		}
		clearTimeout(pending.timer);
		const oldestObservedAt = Math.min(
			...pending.additions.map(({ observedAt }) => observedAt),
			...pending.removals.map(({ observedAt }) => observedAt),
		);
		const delay = Math.max(1, oldestObservedAt + this.pairWindowMs - this.clock());
		pending.timer = setTimeout(() => {
			const current = this.#pendingByBoundary.get(boundary);
			if (current) {
				this.#finishPendingUpdate(boundary, current);
			}
		}, delay);
		pending.timer.unref?.();
	}

	#pruneExpired(pending) {
		const earliestAllowed = this.clock() - this.pairWindowMs;
		pending.additions = pending.additions.filter(
			({ observedAt }) => observedAt > earliestAllowed,
		);
		pending.removals = pending.removals.filter(
			({ observedAt }) => observedAt > earliestAllowed,
		);
	}

	#deletePending(boundary) {
		const pending = this.#pendingByBoundary.get(boundary);
		clearTimeout(pending?.timer);
		this.#pendingByBoundary.delete(boundary);
		this.#pendingBoundaries.delete(boundary);
	}
}

function pairNodesByIndex(removedNodes, addedNodes) {
	const pairCount = Math.min(removedNodes.length, addedNodes.length);
	return {
		pairs: Array.from({ length: pairCount }, (_, index) => ({
			removedNode: removedNodes[index],
			addedNode: addedNodes[index],
		})),
		remainingRemoved: removedNodes.slice(pairCount),
		remainingAdded: addedNodes.slice(pairCount),
	};
}

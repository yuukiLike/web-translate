export function isReciprocalReplacement(addition, removal, removedNode, allowLive) {
	const recordedAdditionTouchesRemoved =
		addition.gap.previousSibling === removedNode || addition.gap.nextSibling === removedNode;
	const liveAdditionTouchesRemoved =
		addition.liveNeighbors.previousSibling === removedNode ||
		addition.liveNeighbors.nextSibling === removedNode;
	return (
		(recordedAdditionTouchesRemoved || (allowLive && liveAdditionTouchesRemoved)) &&
		mutationTouches(removal, addition.node)
	);
}

export function mutationTouches(mutation, node) {
	return mutation.previousSibling === node || mutation.nextSibling === node;
}

export function createReplacementGap(mutation, ordinal, count) {
	return {
		previousSibling: mutation.previousSibling ?? null,
		nextSibling: mutation.nextSibling ?? null,
		ordinal,
		count,
	};
}

export function hasSameReplacementGap(first, second) {
	return (
		first.previousSibling === second.previousSibling &&
		first.nextSibling === second.nextSibling &&
		first.ordinal === second.ordinal &&
		first.count === second.count
	);
}

export function getMutationNodeSlot(mutation, node, kind, fallback) {
	const boundary = mutation.target;
	if (kind === "additions") {
		const index = childIndex(boundary, node);
		return index >= 0 ? index : fallback;
	}
	const nextIndex = childIndex(boundary, mutation.nextSibling);
	if (nextIndex >= 0) {
		return nextIndex + fallback;
	}
	const previousIndex = childIndex(boundary, mutation.previousSibling);
	return previousIndex >= 0 ? previousIndex + 1 + fallback : fallback;
}

export function getLiveNeighbors(boundary, node) {
	const nodes = [...(boundary.childNodes ?? [])];
	const index = nodes.indexOf(node);
	return {
		previousSibling: index > 0 ? nodes[index - 1] : null,
		nextSibling: index >= 0 ? nodes[index + 1] ?? null : null,
	};
}

export function findUniqueIndex(items, predicate) {
	let matchIndex = -1;
	for (const [index, item] of items.entries()) {
		if (!predicate(item)) {
			continue;
		}
		if (matchIndex >= 0) {
			return -1;
		}
		matchIndex = index;
	}
	return matchIndex;
}

function childIndex(boundary, node) {
	return node ? [...(boundary.childNodes ?? [])].indexOf(node) : -1;
}

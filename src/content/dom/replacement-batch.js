/** 把同一位置的记录组成替换组；稳定外部锚点之间的删头加尾保持独立。 */
export function groupClosedReplacementMutations(mutations) {
	const groups = [];
	for (const boundaryMutations of groupChildListMutations(mutations).values()) {
		const groupCountBeforeBoundary = groups.length;
		const splitRecords = [];
		for (const mutation of boundaryMutations) {
			if (mutation.addedNodes.length > 0 && mutation.removedNodes.length > 0) {
				groups.push([mutation]);
			} else {
				splitRecords.push(mutation);
			}
		}
		if (!hasBothSides(splitRecords)) {
			continue;
		}
		const reciprocal = takePairedRecords(splitRecords, hasReciprocalNodes);
		groups.push(...reciprocal.groups);
		const matchingGaps = takePairedRecords(reciprocal.remaining, hasSameGap);
		groups.push(...matchingGaps.groups);
		if (
			groups.length === groupCountBeforeBoundary &&
			hasBothSides(matchingGaps.remaining) &&
			isFullBoundaryReplacement(boundaryMutations)
		) {
			groups.push(matchingGaps.remaining);
		}
	}
	return groups;
}

function isFullBoundaryReplacement(mutations) {
	const addedNodes = new Set(mutations.flatMap((mutation) => [...mutation.addedNodes]));
	const currentChildren = [...(mutations[0]?.target?.childNodes ?? [])];
	return currentChildren.length > 0 && currentChildren.every((node) => addedNodes.has(node));
}

function hasBothSides(mutations) {
	return (
		mutations.some((mutation) => mutation.removedNodes.length > 0) &&
		mutations.some((mutation) => mutation.addedNodes.length > 0)
	);
}

function takePairedRecords(mutations, matches) {
	const consumed = new Set();
	const groups = [];
	for (const removal of mutations.filter((mutation) => mutation.removedNodes.length > 0)) {
		const candidates = mutations.filter(
			(addition) =>
				!consumed.has(addition) &&
				addition.addedNodes.length > 0 &&
				matches(removal, addition),
		);
		if (candidates.length !== 1) {
			continue;
		}
		const [addition] = candidates;
		consumed.add(removal);
		consumed.add(addition);
		groups.push([removal, addition]);
	}
	return { groups, remaining: mutations.filter((mutation) => !consumed.has(mutation)) };
}

function hasReciprocalNodes(removal, addition) {
	return (
		[removal.previousSibling, removal.nextSibling].some((node) =>
			[...addition.addedNodes].includes(node),
		) ||
		[addition.previousSibling, addition.nextSibling].some((node) =>
			[...removal.removedNodes].includes(node),
		)
	);
}

function hasSameGap(first, second) {
	return (
		first.previousSibling === second.previousSibling &&
		first.nextSibling === second.nextSibling
	);
}

export function groupChildListMutations(mutations) {
	const groups = new Map();
	for (const mutation of mutations) {
		if (mutation.type !== "childList") {
			continue;
		}
		const group = groups.get(mutation.target) ?? [];
		group.push(mutation);
		groups.set(mutation.target, group);
	}
	return groups;
}

import { getContentRootKey, getUnownedTextContent, normalizeText } from "./node-utils.js";

/** 按唯一身份、同文结构、同文、槽位顺序配对替换节点；强身份不能降级配对。 */
export function pairReplacementNodes(removedNodes, addedNodes) {
	const remainingRemoved = indexNodes(removedNodes);
	const remainingAdded = indexNodes(addedNodes);
	const removedStrongKeys = countStrongKeys(remainingRemoved);
	const addedStrongKeys = countStrongKeys(remainingAdded);
	const pairs = [];
	if (remainingRemoved.length === 0 || remainingAdded.length === 0) {
		return {
			pairs,
			remainingRemoved: [...removedNodes],
			remainingAdded: [...addedNodes],
			unpairedRemoved: [],
			unpairedAdded: [],
		};
	}
	pairIndexedNodesWhere(
		remainingRemoved,
		remainingAdded,
		pairs,
		(source, target) => {
			const key = strongReplacementKey(source.node);
			return Boolean(
				key &&
				key === strongReplacementKey(target.node) &&
				removedStrongKeys.get(key) === 1 &&
				addedStrongKeys.get(key) === 1,
			);
		},
	);
	pairIndexedNodesWhere(
		remainingRemoved,
		remainingAdded,
		pairs,
		(source, target) => canUseWeakPair(
			source,
			target,
			removedStrongKeys,
			addedStrongKeys,
		) && hasSameNodeText(source.node, target.node) &&
			getContentRootKey(source.node) === getContentRootKey(target.node),
	);
	pairIndexedNodesWhere(
		remainingRemoved,
		remainingAdded,
		pairs,
		(source, target) => canUseWeakPair(
			source,
			target,
			removedStrongKeys,
			addedStrongKeys,
		) && hasSameNodeText(source.node, target.node),
	);
	pairIndexedNodesWhere(
		remainingRemoved,
		remainingAdded,
		pairs,
		(source, target) => canUseWeakPair(
			source,
			target,
			removedStrongKeys,
			addedStrongKeys,
		) && source.index === target.index,
	);
	return {
		pairs: pairs.map(({ source, target }) => ({
			removedNode: source.node,
			addedNode: target.node,
		})),
		remainingRemoved: [],
		remainingAdded: [],
		unpairedRemoved: remainingRemoved.map(({ node }) => node),
		unpairedAdded: remainingAdded.map(({ node }) => node),
	};
}

function indexNodes(nodes) {
	return [...nodes].map((node, index) => ({ index, node }));
}

function hasSameNodeText(source, target) {
	const sourceText = normalizeText(getUnownedTextContent(source));
	return (
		Boolean(sourceText) &&
		sourceText === normalizeText(getUnownedTextContent(target))
	);
}

function countStrongKeys(nodes) {
	const counts = new Map();
	for (const { node } of nodes) {
		const key = strongReplacementKey(node);
		if (key) {
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}

function canUseWeakPair(source, target, sourceCounts, targetCounts) {
	return (
		!hasUniqueStrongKey(source.node, sourceCounts) &&
		!hasUniqueStrongKey(target.node, targetCounts)
	);
}

function hasUniqueStrongKey(node, counts) {
	const key = strongReplacementKey(node);
	return Boolean(key && counts.get(key) === 1);
}

function strongReplacementKey(root) {
	const testId = root.dataset?.testid ?? "";
	const elementId = root.id ?? "";
	const liveRegion = root.getAttribute?.("aria-live") ?? "";
	const role = root.getAttribute?.("role") ?? "";
	const dynamicRole = ["log", "marquee", "progressbar", "status", "timer"].includes(role)
		? role
		: "";
	if (!testId && !elementId && !liveRegion && !dynamicRole) {
		return null;
	}
	return [
		root.tagName ?? "",
		testId,
		elementId,
		dynamicRole,
		liveRegion,
		root.getAttribute?.("lang") ?? "",
	].join("\u0000");
}

function pairIndexedNodesWhere(sources, targets, pairs, matches) {
	for (let sourceIndex = 0; sourceIndex < sources.length;) {
		const source = sources[sourceIndex];
		const sameSlotIndex = targets.findIndex(
			(target) => target.index === source.index && matches(source, target),
		);
		const targetIndex = sameSlotIndex >= 0
			? sameSlotIndex
			: targets.findIndex((target) => matches(source, target));
		if (targetIndex < 0) {
			sourceIndex += 1;
			continue;
		}
		pairs.push({
			source: sources.splice(sourceIndex, 1)[0],
			target: targets.splice(targetIndex, 1)[0],
		});
	}
}

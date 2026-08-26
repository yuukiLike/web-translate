import { forEachTextNode, isOwnedNode } from "./node-utils.js";

export function getMutationElement(mutation) {
	return mutation.target?.nodeType === Node.ELEMENT_NODE
		? mutation.target
		: mutation.target?.parentElement ?? null;
}

export function meaningfulNodes(nodes) {
	return [...nodes].filter(
		(node) => !isOwnedNode(node) && Boolean(normalizeText(node.textContent)),
	);
}

export function hasSameTextValue(mutation) {
	return mutation.oldValue !== undefined &&
		normalizeText(mutation.oldValue) === normalizeText(mutation.target.textContent);
}

export function hasSameReplacementText({ removed, added }) {
	return Boolean(removed.text) && removed.text === added.text;
}

export function normalizeText(value) {
	return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function addTextFallback(side, fallback) {
	if (side.text && side.roots.size === 0) {
		side.roots.add(fallback);
		side.textByRoot.set(fallback, side.text);
	}
}

export function pairContentRoots(removed, added) {
	const remainingRemoved = [...removed.roots];
	const remainingAdded = [...added.roots];
	const pairs = [];
	pairMatchingRoots(
		remainingRemoved,
		remainingAdded,
		pairs,
		(source, target) =>
			Boolean(removed.textByRoot.get(source)) &&
			removed.textByRoot.get(source) === added.textByRoot.get(target) &&
			contentRootKey(source) === contentRootKey(target),
		removed,
		added,
	);
	pairMatchingRoots(
		remainingRemoved,
		remainingAdded,
		pairs,
		(source, target) =>
			Boolean(removed.textByRoot.get(source)) &&
			removed.textByRoot.get(source) === added.textByRoot.get(target),
		removed,
		added,
	);
	pairMatchingRoots(
		remainingRemoved,
		remainingAdded,
		pairs,
		(source, target) => contentRootKey(source) === contentRootKey(target),
		removed,
		added,
	);
	if (remainingRemoved.length === 1 && remainingAdded.length === 1) {
		addPair(pairs, remainingRemoved.pop(), remainingAdded.pop(), removed, added);
	}
	return {
		pairs,
		unpairedRemoved: remainingRemoved,
	};
}

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
			contentRootKey(source.node) === contentRootKey(target.node),
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
	const sourceText = normalizeText(source.textContent);
	return Boolean(sourceText) && sourceText === normalizeText(target.textContent);
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

function pairMatchingRoots(sources, targets, pairs, matches, removed, added) {
	for (let sourceIndex = sources.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
		const source = sources[sourceIndex];
		const targetIndex = targets.findIndex((target) => matches(source, target));
		if (targetIndex < 0) {
			continue;
		}
		const [target] = targets.splice(targetIndex, 1);
		sources.splice(sourceIndex, 1);
		addPair(pairs, source, target, removed, added);
	}
}

function addPair(pairs, source, target, removed, added) {
	pairs.push({
		added: createContentSide(target, added.textByRoot.get(target)),
		removed: createContentSide(source, removed.textByRoot.get(source)),
	});
}

export function collectContentRoots(nodes, { elementStore, tracker, scanner }) {
	const roots = new Set();
	const textParts = [];
	const textByRoot = new Map();
	for (const node of nodes) {
		if (isOwnedNode(node)) {
			continue;
		}
		forEachTextNode(node, (textNode) => {
			if (isOwnedNode(textNode)) {
				return;
			}
			const text = normalizeText(textNode.textContent);
			if (text) {
				textParts.push(text);
			}
			const contentRoot =
				elementStore.getTextOwner(textNode) ??
				tracker.findVolatileContentRoot(textNode.parentElement) ??
				scanner.findContentUnit(textNode.parentElement);
			if (contentRoot) {
				roots.add(contentRoot);
				const rootParts = textByRoot.get(contentRoot) ?? [];
				rootParts.push(text);
				textByRoot.set(contentRoot, rootParts);
			}
		});
	}
	return {
		roots,
		text: textParts.join("\n"),
		textByRoot: new Map(
			[...textByRoot].map(([root, parts]) => [root, parts.join("\n")]),
		),
	};
}

function createContentSide(root, text = "") {
	return { roots: new Set([root]), text };
}

function contentRootKey(root) {
	return [
		root.tagName ?? "",
		root.dataset?.testid ?? "",
		root.getAttribute?.("role") ?? "",
		root.getAttribute?.("lang") ?? "",
	].join("\u0000");
}

import {
	forEachTextNode,
	getContentRootKey,
	normalizeText,
	isOwnedNode,
} from "./node-utils.js";

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
			getContentRootKey(source) === getContentRootKey(target),
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
		(source, target) => getContentRootKey(source) === getContentRootKey(target),
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

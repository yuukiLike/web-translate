import { SITE_PRESENTATION } from "../site-profile.js";
import {
	canTransferTrackedGeneratedPresentation,
	transferTrackedGeneratedPresentation,
} from "./generated-presentation.js";
import { forEachTextNode, isOwnedNode, sourceSelector } from "./node-utils.js";
import { groupClosedReplacementMutations } from "./replacement-batch.js";

/** 同一宿主替换批次内，把已翻译 surface 迁移到语义等价的新 Element。 */
export function transferGeneratedReplacements({
	mutations,
	elementStore,
	progress,
	scanner,
	runId,
	rootQueue,
}) {
	const replacements = collectReplacementBoundaries(
		mutations,
		elementStore,
		scanner,
		runId,
	);
	let transferred = false;
	for (const { added, removed } of replacements.values()) {
		transferred =
			transferReplacementGroup({
				removedSources: removed,
				addedCandidates: added,
				elementStore,
				progress,
				scanner,
				runId,
				rootQueue,
			}) || transferred;
	}
	return transferred;
}

/** 返回可无损迁移的完整一一配对；任一节点不满足身份时整组拒绝。 */
export function matchCompleteGeneratedReplacements({
	removedSources,
	addedCandidates,
	elementStore,
	runId,
	scanner,
}) {
	if (removedSources.length === 0 || removedSources.length !== addedCandidates.length) {
		return null;
	}
	if (
		removedSources.some(
			(source) => source.isConnected || !elementStore.generatedSources.has(source),
		) ||
		addedCandidates.some(
			(candidate) =>
				!candidate.isConnected ||
				elementStore.hasState(candidate) ||
				scanner.getPresentation(candidate) !== SITE_PRESENTATION.generated,
		)
	) {
		return null;
	}
	const removedByKey = groupByKey(removedSources, (source) =>
		getReplacementKey(source, elementStore.getState(source)?.originalHash),
	);
	const addedByKey = groupByKey(addedCandidates, (candidate) => {
		const current = scanner.currentCandidate(candidate);
		return current
			? getReplacementKey(candidate, scanner.core.hashText(current.text))
			: null;
	});
	if (
		countGrouped(removedByKey) !== removedSources.length ||
		countGrouped(addedByKey) !== addedCandidates.length
	) {
		return null;
	}
	const pairs = [];
	for (const [key, sources] of removedByKey) {
		const candidates = addedByKey.get(key);
		if (!candidates || sources.length !== candidates.length) {
			return null;
		}
		for (const [index, source] of sources.entries()) {
			const target = candidates[index];
			if (
				!canTransferTrackedGeneratedPresentation({
					target,
					translation: elementStore.getState(source)?.translationNode,
					runId,
				})
			) {
				return null;
			}
			pairs.push({ source, target });
		}
	}
	return pairs;
}

function collectReplacementBoundaries(mutations, elementStore, scanner, runId) {
	const replacements = [];
	for (const boundaryMutations of groupClosedReplacementMutations(mutations)) {
		const boundary = { added: new Set(), removed: new Set() };
		for (const mutation of boundaryMutations) {
			for (const node of mutation.removedNodes) {
				collectRemovedSources(node, boundary.removed, elementStore, runId);
			}
			for (const node of mutation.addedNodes) {
				collectAddedCandidates(node, boundary.added, elementStore, scanner);
			}
		}
		replacements.push(boundary);
	}
	return replacements;
}

function collectRemovedSources(node, removedSources, elementStore, runId) {
	const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
	if (!element) {
		return;
	}
	const trackedSources = new Set();
	forEachTextNode(node, (textNode) => {
		const owner = elementStore.getTextOwner(textNode);
		if (owner && elementStore.generatedSources.has(owner)) {
			trackedSources.add(owner);
		}
	});
	if (element.matches?.(sourceSelector(runId))) {
		trackedSources.add(element);
	}
	for (const source of element.querySelectorAll?.(sourceSelector(runId)) ?? []) {
		trackedSources.add(source);
	}
	for (const source of trackedSources) {
		if (elementStore.generatedSources.has(source) && !source.isConnected) {
			removedSources.add(source);
		}
	}
}

function collectAddedCandidates(node, addedCandidates, elementStore, scanner) {
	if (isOwnedNode(node)) {
		return;
	}
	forEachTextNode(node, (textNode) => {
		const candidate = scanner.findContentUnit(textNode.parentElement);
		if (
			candidate?.isConnected &&
			!elementStore.hasState(candidate) &&
			scanner.getPresentation(candidate) === SITE_PRESENTATION.generated
		) {
			addedCandidates.add(candidate);
		}
	});
}

function transferReplacementGroup({
	removedSources,
	addedCandidates,
	elementStore,
	progress,
	scanner,
	runId,
	rootQueue,
}) {
	const removedByKey = groupByKey(removedSources, (source) =>
		getReplacementKey(source, elementStore.getState(source)?.originalHash),
	);
	const addedByKey = groupByKey(addedCandidates, (candidate) => {
		const current = scanner.currentCandidate(candidate);
		return current
			? getReplacementKey(candidate, scanner.core.hashText(current.text))
			: null;
	});
	let transferred = false;
	for (const [key, sources] of removedByKey) {
		const candidates = addedByKey.get(key);
		if (!candidates || sources.length !== candidates.length) {
			continue;
		}
		for (const [index, source] of sources.entries()) {
			transferred =
				transferReplacement(
					source,
					candidates[index],
					elementStore,
					progress,
					scanner,
					runId,
					rootQueue,
				) ||
				transferred;
		}
	}
	return transferred;
}

function transferReplacement(
	source,
	target,
	elementStore,
	progress,
	scanner,
	runId,
	rootQueue,
) {
	const state = elementStore.getState(source);
	const candidate = scanner.currentCandidate(target);
	if (
		!state?.translationNode ||
		!candidate ||
		!transferTrackedGeneratedPresentation(
			source,
			target,
			state.translationNode,
			runId,
			candidate.presentationAnchor,
		)
	) {
		return false;
	}
	elementStore.setState(target, {
		...state,
		revision: elementStore.nextRevision(target),
	});
	progress.transfer(source, target);
	elementStore.deleteState(source);
	elementStore.deferredElements.delete(target);
	elementStore.generatedSources.delete(source);
	elementStore.generatedSources.add(target);
	elementStore.rememberTranslationSource(state.translationNode, target);
	rootQueue.add(target);
	return true;
}

function getReplacementKey(element, hash) {
	if (!hash) {
		return null;
	}
	const language = element.getAttribute?.("lang") ?? "";
	return [hash, element.tagName, element.dataset?.testid ?? "", language].join("\u0000");
}

function groupByKey(elements, getKey) {
	const groups = new Map();
	for (const element of elements) {
		const key = getKey(element);
		if (!key) {
			continue;
		}
		const group = groups.get(key) ?? [];
		group.push(element);
		groups.set(key, group);
	}
	return groups;
}

function countGrouped(groups) {
	return [...groups.values()].reduce((total, group) => total + group.length, 0);
}

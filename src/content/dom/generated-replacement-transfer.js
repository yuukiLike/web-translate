import { SITE_PRESENTATION } from "../site-profile.js";
import { transferTrackedGeneratedPresentation } from "./generated-presentation.js";
import { forEachTextNode, isOwnedNode, sourceSelector } from "./node-utils.js";

/** 同一宿主替换批次内，把已翻译 surface 迁移到语义等价的新 Element。 */
export function transferGeneratedReplacements({
	mutations,
	elementStore,
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
				scanner,
				runId,
				rootQueue,
			}) || transferred;
	}
	return transferred;
}

function collectReplacementBoundaries(mutations, elementStore, scanner, runId) {
	const replacements = new Map();
	for (const mutation of mutations) {
		if (mutation.type !== "childList") {
			continue;
		}
		const boundary = getReplacementBoundary(replacements, mutation.target);
		for (const node of mutation.removedNodes) {
			collectRemovedSources(node, boundary.removed, elementStore, runId);
		}
		for (const node of mutation.addedNodes) {
			collectAddedCandidates(node, boundary.added, elementStore, scanner);
		}
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
				transferReplacement(source, candidates[index], elementStore, runId, rootQueue) ||
				transferred;
		}
	}
	return transferred;
}

function transferReplacement(source, target, elementStore, runId, rootQueue) {
	const state = elementStore.getState(source);
	if (
		!state?.translationNode ||
		!transferTrackedGeneratedPresentation(source, target, state.translationNode, runId)
	) {
		return false;
	}
	elementStore.setState(target, {
		...state,
		revision: elementStore.nextRevision(target),
	});
	elementStore.deleteState(source);
	elementStore.deferredElements.delete(target);
	elementStore.generatedSources.delete(source);
	elementStore.generatedSources.add(target);
	elementStore.rememberTranslationSource(state.translationNode, target);
	rootQueue.add(target);
	return true;
}

function getReplacementBoundary(replacements, target) {
	let boundary = replacements.get(target);
	if (!boundary) {
		boundary = { added: new Set(), removed: new Set() };
		replacements.set(target, boundary);
	}
	return boundary;
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

import { SITE_PRESENTATION } from "../site-profile.js";
import {
	createGeneratedTranslationNode,
	GENERATED_TRANSLATION_SELECTOR,
	isGeneratedTranslationStructureIntact,
	isOwnedGeneratedNode,
	LEGACY_DESCRIPTION_SELECTOR,
	normalizeGeneratedTranslation,
	OWNED_GENERATED_NODE_SELECTOR,
} from "./generated-translation-structure.js";

const GENERATED_SOURCE_SELECTOR = [
	"[data-bt-generated-owned='true']",
	"[data-bt-presentation='generated'][data-bt-presentation-run][data-bt-description-id]",
].join(", ");
const GENERATED_DATASET_NAMES = [
	"btSource",
	"btLoading",
	"btGeneratedOwned",
	"btPresentation",
	"btPresentationRun",
	"btTranslation",
	"btTranslationLang",
	"btDescriptionId",
];

let translationSequence = 0;
const generatedPresentations = new WeakMap();

/** 创建 source 原生文本承载节点内可见、可选择的真实译文。 */
export function createGeneratedTranslation({ anchor, source, text, language, runId }) {
	const presentation = {
		anchor,
		id: nextTranslationId(document, runId),
		language,
		runId,
		text,
	};
	const translation = createGeneratedTranslationNode(document, presentation);
	generatedPresentations.set(translation, presentation);
	return restoreGeneratedPresentation(source, translation, runId, anchor)
		? translation
		: null;
}

/** 宿主删除节点或清理属性时，在下一次绘制前复挂同一个真实译文节点。 */
export function restoreGeneratedPresentation(source, translation, runId, anchor = null) {
	const presentation = getTrackedPresentation(translation, runId);
	const target = resolvePresentationAnchor(source, presentation, anchor);
	if (
		!source?.isConnected ||
		!presentation ||
		!target ||
		source.ownerDocument !== translation.ownerDocument
	) {
		return false;
	}
	normalizeGeneratedTranslation(translation, presentation);
	removeCompetingGeneratedChildren(source, translation, presentation.id);
	if (translation.parentElement !== target) {
		target.append(translation);
	}
	presentation.anchor = target;
	source.dataset.btSource = runId;
	source.dataset.btGeneratedOwned = "true";
	source.dataset.btPresentation = SITE_PRESENTATION.generated;
	source.dataset.btPresentationRun = runId;
	source.dataset.btTranslation = presentation.text;
	source.dataset.btTranslationLang = presentation.language;
	source.dataset.btDescriptionId = presentation.id;
	return true;
}

export function isGeneratedPresentationIntact(source, translation, runId) {
	const presentation = getTrackedPresentation(translation, runId);
	const anchor = presentation?.anchor;
	if (
		!source?.isConnected ||
		!presentation ||
		!isValidPresentationAnchor(source, anchor) ||
		!translation?.isConnected ||
		translation.parentElement !== anchor ||
		!hasOnlyTrackedGeneratedChild(source, translation, presentation.id) ||
		!isGeneratedTranslationStructureIntact(translation, presentation) ||
		source.dataset.btSource !== runId ||
		source.dataset.btGeneratedOwned !== "true" ||
		source.dataset.btPresentation !== SITE_PRESENTATION.generated ||
		source.dataset.btPresentationRun !== runId ||
		source.dataset.btDescriptionId !== presentation.id ||
		source.dataset.btTranslation !== presentation.text ||
		source.dataset.btTranslationLang !== presentation.language
	) {
		return false;
	}
	return true;
}

/** ElementStore 已确认归属后，把同一个真实译文节点原子迁移到同文新 source。 */
export function transferTrackedGeneratedPresentation(
	source,
	target,
	translation,
	runId,
	anchor,
) {
	const presentation = getTrackedPresentation(translation, runId);
	if (
		!presentation ||
		!canTransferTrackedGeneratedPresentation({ target, translation, runId }) ||
		!restoreGeneratedPresentation(target, translation, runId, anchor)
	) {
		return false;
	}
	clearGeneratedSourceAttributes(source, presentation.id);
	for (const copy of findOwnedGeneratedNodes(source, presentation.id)) {
		if (copy !== translation) {
			copy.remove();
		}
	}
	return true;
}

/** 迁移前 source 可以已脱离文档；节点归属和目标连通性必须仍可信。 */
export function canTransferTrackedGeneratedPresentation({ target, translation, runId }) {
	return Boolean(
		target?.isConnected &&
			target.ownerDocument === translation?.ownerDocument &&
			getTrackedPresentation(translation, runId),
	);
}

/** 幂等清理 source 属性和可见译文，并移除旧版离屏描述留下的 ARIA 引用。 */
export function clearGeneratedPresentation(
	source,
	{ runId = null, descriptionId = null, translationNode = null } = {},
) {
	if (!source?.dataset) {
		return false;
	}
	if (
		runId &&
		source.dataset.btPresentationRun !== runId &&
		source.dataset.btSource !== runId
	) {
		return false;
	}
	const currentDescriptionId = source.dataset.btDescriptionId;
	if (descriptionId && currentDescriptionId && currentDescriptionId !== descriptionId) {
		return false;
	}
	const trackedId = generatedPresentations.get(translationNode)?.id;
	const ownedNodeId = trackedId || currentDescriptionId || descriptionId || translationNode?.id || null;
	const ownedNodes = findOwnedGeneratedNodes(source, ownedNodeId, translationNode);
	clearGeneratedSourceAttributes(source, ownedNodeId);
	for (const node of ownedNodes) {
		node.remove();
	}
	return Boolean(ownedNodeId || ownedNodes.size > 0);
}

function getTrackedPresentation(translation, runId) {
	const presentation = generatedPresentations.get(translation);
	return presentation?.runId === runId ? presentation : null;
}

function resolvePresentationAnchor(source, presentation, requestedAnchor) {
	if (!presentation) {
		return null;
	}
	if (isValidPresentationAnchor(source, requestedAnchor)) {
		return requestedAnchor;
	}
	return isValidPresentationAnchor(source, presentation.anchor)
		? presentation.anchor
		: null;
}

function isValidPresentationAnchor(source, anchor) {
	return Boolean(
		source &&
		anchor?.nodeType === Node.ELEMENT_NODE &&
		(anchor === source || source.contains(anchor)) &&
		!isOwnedGeneratedNode(anchor),
	);
}

function removeCompetingGeneratedChildren(source, translation, translationId) {
	for (const child of findSurfaceNodes(source, translationId)) {
		if (child !== translation) {
			child.remove();
		}
	}
}

function hasOnlyTrackedGeneratedChild(source, translation, translationId) {
	const generatedChildren = findSurfaceNodes(source, translationId);
	return generatedChildren.length === 1 && generatedChildren[0] === translation;
}

function findSurfaceNodes(source, translationId) {
	const nodes = [];
	for (const node of source.querySelectorAll?.(OWNED_GENERATED_NODE_SELECTOR) ?? []) {
		if (node.parentElement === source || node.id === translationId) {
			nodes.push(node);
		}
	}
	return nodes;
}

function findOwnedGeneratedNodes(source, nodeId, trackedNode = null) {
	const nodes = new Set();
	if (trackedNode?.nodeType === Node.ELEMENT_NODE) {
		nodes.add(trackedNode);
	}
	const descendants = source.querySelectorAll?.(OWNED_GENERATED_NODE_SELECTOR) ?? [];
	for (const node of descendants) {
		if (!nodeId || node.id === nodeId) {
			nodes.add(node);
		}
	}
	const connectedNode = nodeId ? source.ownerDocument?.getElementById(nodeId) : null;
	if (isOwnedGeneratedNode(connectedNode)) {
		nodes.add(connectedNode);
	}
	return nodes;
}

function findOwnedGeneratedNode(source, nodeId) {
	return findOwnedGeneratedNodes(source, nodeId).values().next().value ?? null;
}

function clearGeneratedSourceAttributes(source, descriptionId) {
	if (descriptionId) {
		removeDescriptionReference(source, descriptionId);
	}
	for (const name of GENERATED_DATASET_NAMES) {
		delete source.dataset[name];
	}
}

/** 新运行或停止运行时按 source 显式清理，不依赖旧脚本上下文中的实例方法。 */
export function cleanupGeneratedPresentations(root = document, runId = null) {
	const sources = [];
	if (root.matches?.(GENERATED_SOURCE_SELECTOR)) {
		sources.push(root);
	}
	sources.push(...(root.querySelectorAll?.(GENERATED_SOURCE_SELECTOR) ?? []));
	for (const source of sources) {
		if (isOwnedGeneratedSource(source)) {
			clearGeneratedPresentation(source, { runId });
		}
	}
}

function isOwnedGeneratedSource(source) {
	if (source.dataset.btGeneratedOwned === "true") {
		return true;
	}
	const descriptionId = source.dataset.btDescriptionId;
	const presentationRun = source.dataset.btPresentationRun;
	const node = findOwnedGeneratedNode(source, descriptionId);
	return Boolean(
		source.dataset.btPresentation === SITE_PRESENTATION.generated &&
			presentationRun &&
			node?.dataset.btRun === presentationRun,
	);
}

function nextTranslationId(documentRef, runId) {
	let id;
	do {
		translationSequence += 1;
		id = `bt-translation-generated-${runId}-${translationSequence}`;
	} while (documentRef.getElementById(id));
	return id;
}

function removeDescriptionReference(source, descriptionId) {
	const references = getDescriptionReferences(source).filter(
		(value) => value !== descriptionId,
	);
	if (references.length > 0) {
		source.setAttribute("aria-describedby", references.join(" "));
	} else {
		source.removeAttribute("aria-describedby");
	}
}

function getDescriptionReferences(source) {
	return (source.getAttribute("aria-describedby") ?? "")
		.split(/\s+/u)
		.filter(Boolean);
}

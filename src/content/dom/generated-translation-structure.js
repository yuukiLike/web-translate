export const GENERATED_TRANSLATION_SELECTOR =
	".bt-translation.bt-translation-generated[data-bt-owned='true']";
export const LEGACY_DESCRIPTION_SELECTOR =
	".bt-translation.bt-translation-description[data-bt-owned='true']";
export const OWNED_GENERATED_NODE_SELECTOR = [
	GENERATED_TRANSLATION_SELECTOR,
	LEGACY_DESCRIPTION_SELECTOR,
].join(", ");

const OUTER_CLASS = "bt-translation bt-translation-generated notranslate";
const INNER_CLASS = "bt-translation-inner notranslate";
const BREAK_CLASS = "bt-translation-break";

/** 创建 outer / br / inner / Text 的稳定身份；后续修复只复用这些节点。 */
export function createGeneratedTranslationNode(documentRef, presentation) {
	const translation = documentRef.createElement("span");
	presentation.lineBreak = documentRef.createElement("br");
	presentation.inner = documentRef.createElement("span");
	presentation.textNode = documentRef.createTextNode(presentation.text);
	normalizeGeneratedTranslation(translation, presentation);
	return translation;
}

/** 恢复规范结构，不通过 textContent 重建 inner 或真实 Text。 */
export function normalizeGeneratedTranslation(translation, presentation) {
	setAttributeValue(translation, "id", presentation.id);
	setAttributeValue(translation, "class", OUTER_CLASS);
	setAttributeValue(translation, "data-bt-owned", "true");
	setAttributeValue(translation, "data-bt-run", presentation.runId);
	setAttributeValue(translation, "lang", presentation.language);
	setAttributeValue(translation, "translate", "no");
	translation.removeAttribute("aria-hidden");

	setAttributeValue(presentation.lineBreak, "class", BREAK_CLASS);
	presentation.lineBreak.removeAttribute("aria-hidden");
	removeChildren(presentation.lineBreak);

	setAttributeValue(presentation.inner, "class", INNER_CLASS);
	setAttributeValue(presentation.inner, "lang", presentation.language);
	presentation.inner.removeAttribute("aria-hidden");
	if (presentation.textNode.data !== presentation.text) {
		presentation.textNode.data = presentation.text;
	}
	setCanonicalChildren(presentation.inner, [presentation.textNode]);
	setCanonicalChildren(translation, [presentation.lineBreak, presentation.inner]);
}

export function isGeneratedTranslationStructureIntact(translation, presentation) {
	return Boolean(
		translation?.matches(GENERATED_TRANSLATION_SELECTOR) &&
		translation.className === OUTER_CLASS &&
		translation.id === presentation.id &&
		translation.dataset.btRun === presentation.runId &&
		translation.lang === presentation.language &&
		translation.getAttribute("translate") === "no" &&
		!translation.hasAttribute("aria-hidden") &&
		translation.childNodes.length === 2 &&
		translation.firstChild === presentation.lineBreak &&
		translation.lastChild === presentation.inner &&
		presentation.lineBreak.className === BREAK_CLASS &&
		!presentation.lineBreak.hasAttribute("aria-hidden") &&
		presentation.inner.className === INNER_CLASS &&
		presentation.inner.lang === presentation.language &&
		!presentation.inner.hasAttribute("aria-hidden") &&
		presentation.inner.childNodes.length === 1 &&
		presentation.inner.firstChild === presentation.textNode &&
		presentation.textNode.data === presentation.text
	);
}

export function isOwnedGeneratedNode(node) {
	return Boolean(node?.matches?.(OWNED_GENERATED_NODE_SELECTOR));
}

function setCanonicalChildren(parent, expectedChildren) {
	for (const [index, expected] of expectedChildren.entries()) {
		if (parent.childNodes[index] !== expected) {
			parent.insertBefore(expected, parent.childNodes[index] ?? null);
		}
	}
	for (const child of [...parent.childNodes]) {
		if (!expectedChildren.includes(child)) {
			child.remove();
		}
	}
}

function removeChildren(parent) {
	for (const child of [...parent.childNodes]) {
		child.remove();
	}
}

function setAttributeValue(element, name, value) {
	if (element.getAttribute(name) !== value) {
		element.setAttribute(name, value);
	}
}

import assert from "node:assert/strict";

export function getGeneratedTranslation(source) {
	return source.querySelector(".bt-translation-generated[data-bt-owned='true']");
}

export function getGeneratedTranslationInner(translation) {
	return translation?.querySelector(":scope > .bt-translation-inner") ?? null;
}

export function assertGeneratedTranslation(source, expectedText) {
	assert.equal(source.dataset.btPresentation, "generated");
	assert.equal(source.dataset.btTranslation, expectedText);
	const translation = getGeneratedTranslation(source);
	assert.equal(source.contains(translation), true);
	assert.equal(translation?.textContent, expectedText);
	assert.equal(translation?.id, source.dataset.btDescriptionId);
	assert.equal(source.ownerDocument.getElementById(translation.id), translation);
	assert.equal(translation.hasAttribute("aria-hidden"), false);
	assert.equal(translation.getAttribute("translate"), "no");
	assert.equal(translation.classList.contains("notranslate"), true);
	const inner = getGeneratedTranslationInner(translation);
	assert.equal(translation.childNodes.length, 2);
	assert.equal(translation.firstChild?.nodeName, "BR");
	assert.equal(translation.lastChild, inner);
	assert.equal(inner?.lang, source.dataset.btTranslationLang);
	assert.equal(inner?.textContent, expectedText);
	return translation;
}

export function assertHostNodes(parent, originalNodes, translation = null) {
	const translationIsDirectChild = translation?.parentElement === parent;
	assert.equal(
		parent.childNodes.length,
		originalNodes.length + (translationIsDirectChild ? 1 : 0),
	);
	for (const [index, node] of originalNodes.entries()) {
		assert.equal(parent.childNodes[index], node);
	}
	if (translation) {
		assert.equal(parent.contains(translation), true);
		if (translationIsDirectChild) {
			assert.equal(parent.lastChild, translation);
		}
	} else {
		assert.equal(getGeneratedTranslation(parent), null);
	}
}

export function assertSelectableTranslation(window, translation, expectedText) {
	const textNode = getGeneratedTranslationInner(translation)?.firstChild;
	assert.equal(textNode?.nodeType, window.Node.TEXT_NODE);
	assert.equal(textNode?.data, expectedText);
	const range = window.document.createRange();
	range.setStart(textNode, 0);
	range.setEnd(textNode, textNode.data.length);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	assert.equal(selection.anchorNode, textNode);
	assert.equal(selection.focusNode, textNode);
	assert.equal(selection.anchorOffset, 0);
	assert.equal(selection.focusOffset, textNode.data.length);
	assert.equal(selection.toString(), expectedText);
	selection.removeAllRanges();
}

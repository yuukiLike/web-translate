import { OWNED_NODE_SELECTOR, SELECTORS } from "../constants.js";

const READABLE_PLAIN_TEXT_TYPES = new Set([
	"text/markdown",
	"text/plain",
	"text/x-markdown",
]);

/** 普通代码区保持排除，但允许浏览器为纯文本响应生成的根级 pre。 */
export function isTranslationExcluded(element) {
	if (isSemanticallyHidden(element) || element?.closest?.(SELECTORS.excluded)) {
		return true;
	}
	const codeLikeAncestor = element?.closest?.(SELECTORS.codeLike);
	return Boolean(codeLikeAncestor && !isReadablePlainTextRoot(codeLikeAncestor));
}

function isSemanticallyHidden(element) {
	for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
		if (ancestor.hasAttribute?.("inert")) {
			return true;
		}
		if (String(ancestor.getAttribute?.("aria-hidden") ?? "").toLowerCase() === "true") {
			return true;
		}
	}
	return false;
}

function isReadablePlainTextRoot(element) {
	const rootPre = element.matches("pre") ? element : element.closest("pre");
	return Boolean(
		rootPre?.parentElement === document.body &&
		READABLE_PLAIN_TEXT_TYPES.has(String(document.contentType).toLowerCase()),
	);
}

export function isOwnedNode(node) {
	const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
	return Boolean(
		element?.matches?.(OWNED_NODE_SELECTOR) || element?.closest?.(OWNED_NODE_SELECTOR),
	);
}

export function forEachTextNode(node, callback) {
	if (node.nodeType === Node.TEXT_NODE) {
		callback(node);
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return;
	}
	const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
	for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
		callback(textNode);
	}
}

export function sourceSelector(runId) {
	return `[data-bt-source="${CSS.escape(runId)}"]`;
}

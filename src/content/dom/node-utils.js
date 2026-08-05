import { OWNED_NODE_SELECTOR } from "../constants.js";

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

import { isOwnedNode, isReadablePlainTextRoot } from "./node-utils.js";

const NON_TEXT_CONTENT = [
	"script", "style", "noscript", "template", "svg", "math", "canvas",
	"input", "textarea", "select", "option", "audio", "video", "kbd", "samp",
	"[role='math']", ".katex", "mjx-container",
	"[contenteditable]:not([contenteditable='false'])",
].join(",");

/** 同时保留换行边界，剪掉无正文的子树，并进入开放的 Web Component。 */
export function* readableNodes(root) {
	if (!root || isOwnedNode(root) || isNonTextElement(root)) return;
	if (root.nodeType === Node.TEXT_NODE) {
		yield root;
		return;
	}
	if (root.shadowRoot) {
		yield* readableNodes(root.shadowRoot);
		return;
	}
	const assigned = root.localName === "slot" ? root.assignedNodes() : [];
	if (assigned.length) {
		for (const node of assigned) yield* readableNodes(node);
		return;
	}
	const walker = root.ownerDocument.createTreeWalker(
		root,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		{
			acceptNode(node) {
				return isOwnedNode(node) || isNonTextElement(node) || isUnrenderedLightChild(node)
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT;
			},
		},
	);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.nodeType === Node.TEXT_NODE || node.tagName === "BR") yield node;
		if (node.shadowRoot || (node.localName === "slot" && node.assignedNodes().length)) yield* readableNodes(node);
	}
}

function isUnrenderedLightChild(node) {
	const parent = node.parentElement;
	return Boolean(parent?.shadowRoot || (parent?.localName === "slot" && parent.assignedNodes().length));
}

function isNonTextElement(node) {
	if (node.nodeType !== Node.ELEMENT_NODE) return false;
	return node.matches(NON_TEXT_CONTENT) || (node.matches("pre") && !isReadablePlainTextRoot(node));
}

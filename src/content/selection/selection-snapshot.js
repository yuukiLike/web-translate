import { closestComposed, textParent } from "../dom/node-utils.js";

const EXCLUDED = "[data-bt-ui], input, textarea, [contenteditable]:not([contenteditable='false'])";

/** 先保存文字和范围，再打开 UI；后续按钮操作不依赖浏览器还保留着原选区。 */
export function captureSelection(core) {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
	if (activeElement()?.closest?.("[data-bt-ui]")) return null;
	if (isExcluded(selection.anchorNode) || isExcluded(selection.focusNode)) return null;
	try {
		const text = core.normalizeSourceText(selection.toString());
		if (!text || !/\p{L}/u.test(text)) return null;
		const shadowRoots = [...new Set([
			...ancestorShadowRoots(selection.anchorNode), ...ancestorShadowRoots(selection.focusNode),
		])];
		const bounds = selection.getComposedRanges?.({ shadowRoots })[0] ?? selection.getRangeAt(0);
		if (isExcluded(bounds.startContainer) || isExcluded(bounds.endContainer)) return null;
		const boundary = {
			startContainer: bounds.startContainer, startOffset: bounds.startOffset,
			endContainer: bounds.endContainer, endOffset: bounds.endOffset,
		};
		const backward = selection.direction === "backward" ||
			(selection.focusNode === boundary.startContainer && selection.focusOffset === boundary.startOffset);
		const range = document.createRange();
		// DOM Range 不能跨越两个树根；跨 Shadow DOM 时用选择终点作为定位锚点。
		if (boundary.startContainer.getRootNode() === boundary.endContainer.getRootNode()) {
			range.setStart(boundary.startContainer, boundary.startOffset);
			range.setEnd(boundary.endContainer, boundary.endOffset);
		} else {
			const node = backward ? boundary.startContainer : boundary.endContainer;
			const offset = backward ? boundary.startOffset : boundary.endOffset;
			range.setStart(node, offset);
			range.collapse(true);
		}
		return { text, boundary, range, backward };
	} catch {
		return null; // 页面在读取期间删除了选择节点，等待下一次用户选择。
	}
}

export function sameSelection(first, second) {
	if (!first || !second || first.text !== second.text) return false;
	const a = first.boundary;
	const b = second.boundary;
	return Boolean(a && b && a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
		a.endContainer === b.endContainer && a.endOffset === b.endOffset);
}

export function selectionConnected(snapshot) {
	return !snapshot.boundary || (snapshot.boundary.startContainer.isConnected && snapshot.boundary.endContainer.isConnected);
}

export function selectionRectangle(snapshot) {
	if (!snapshot.range || !selectionConnected(snapshot)) return null;
	const caret = snapshot.range.cloneRange();
	caret.collapse(snapshot.backward);
	const endpoint = [...caret.getClientRects()].find((rect) => rect.height > 0);
	if (endpoint) return endpoint;
	const rectangles = [...snapshot.range.getClientRects()].filter((rect) => rect.height > 0);
	if (rectangles.length) return snapshot.backward ? rectangles[0] : rectangles.at(-1);
	const { startContainer, startOffset, endContainer, endOffset } = snapshot.boundary;
	const container = snapshot.backward ? startContainer : endContainer;
	const offset = snapshot.backward ? startOffset : endOffset;
	const child = container.childNodes?.[snapshot.backward ? offset : Math.max(0, offset - 1)];
	const element = child?.nodeType === Node.ELEMENT_NODE ? child : elementFor(child ?? container);
	const rectangle = element?.getBoundingClientRect();
	return rectangle?.height > 0 ? rectangle : null;
}

export function selectionRoots(snapshot) {
	if (!snapshot.boundary) return [document];
	return [...new Set([document, snapshot.boundary.startContainer.getRootNode(), snapshot.boundary.endContainer.getRootNode()])];
}

export function isEditingEvent(event) {
	return event.composedPath().some((node) => node.nodeType === Node.ELEMENT_NODE &&
		(node.matches("input, textarea") || node.isContentEditable));
}

export function activeElement() {
	let element = document.activeElement;
	while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
	return element;
}

function isExcluded(node) {
	return Boolean(closestComposed(elementFor(node), EXCLUDED));
}

function elementFor(node) {
	return node?.nodeType === Node.ELEMENT_NODE ? node : node ? textParent(node) : null;
}

function* ancestorShadowRoots(node) {
	for (let root = node?.getRootNode(); root?.host; root = root.host.getRootNode()) {
		if (root.mode === "open") yield root;
	}
}

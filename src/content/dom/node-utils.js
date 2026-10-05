import { OWNED_NODE_SELECTOR, SELECTORS } from "../constants.js";

const READABLE_PLAIN_TEXT_TYPES = new Set([
	"text/markdown",
	"text/plain",
	"text/x-markdown",
]);

/** 普通代码区保持排除，但允许浏览器为纯文本响应生成的根级 pre。 */
export function isTranslationExcluded(element) {
	if (
		isSemanticallyHidden(element) ||
		closestComposed(element, SELECTORS.excluded) ||
		hasLocalTranslateOptOut(element)
	) {
		return true;
	}
	const codeLikeAncestor = closestComposed(element, SELECTORS.codeLike);
	if (!codeLikeAncestor || isReadablePlainTextRoot(codeLikeAncestor)) return false;
	// 行内代码是句子的一部分，保留它的语义；整块程序仍然跳过。
	return Boolean(closestComposed(codeLikeAncestor, "pre") || !closestComposed(codeLikeAncestor,
		`${SELECTORS.leaf}, ${SELECTORS.structural}`,
	));
}

export function composedParent(element) {
	return element?.assignedSlot ?? element?.parentElement ?? element?.getRootNode?.().host ?? null;
}

export function closestComposed(element, selector) {
	for (let current = element; current; current = composedParent(current)) {
		if (current.matches?.(selector)) return current;
	}
	return null;
}

export function textParent(node) {
	return composedParent(node);
}

export function containsComposed(root, node) {
	for (let current = node; current; current = composedParent(current)) {
		if (root === current || root?.contains(current)) return true;
	}
	return false;
}

/** 查询与清理和扫描共用开放根边界，不能只处理宿主的 light DOM。 */
export function* openRoots(root) {
	if (!root) return;
	yield root;
	if (root.shadowRoot) yield* openRoots(root.shadowRoot);
	const documentRef = root.ownerDocument ?? root;
	const walker = documentRef.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
	for (let element = walker.nextNode(); element; element = walker.nextNode()) {
		if (element.shadowRoot) yield* openRoots(element.shadowRoot);
	}
}

export function* queryAcrossRoots(root, selector) {
	for (const domRoot of openRoots(root)) yield* domRoot.querySelectorAll(selector);
}

/** 页面外壳的 translate=no 不应清空整页候选；正文中的局部声明仍需遵守。 */
function hasLocalTranslateOptOut(element) {
	const contentRoot = closestComposed(element, SELECTORS.root);
	for (let ancestor = element; ancestor; ancestor = composedParent(ancestor)) {
		if (!ancestor.hasAttribute?.("translate")) {
			continue;
		}
		const directive = String(ancestor.getAttribute("translate") ?? "").toLowerCase();
		if (directive === "" || directive === "yes") {
			return false;
		}
		if (directive !== "no") {
			continue; // HTML 枚举属性的非法值继承外层声明。
		}
		if (isPageTranslateOptOut(ancestor, contentRoot)) {
			continue;
		}
		return true;
	}
	return false;
}

function isPageTranslateOptOut(boundary, contentRoot) {
	const ownerDocument = boundary.ownerDocument;
	if (boundary === ownerDocument?.documentElement || boundary === ownerDocument?.body) {
		return true;
	}
	return Boolean(
		contentRoot &&
			contentRoot !== boundary &&
			boundary.parentElement === ownerDocument?.body &&
			containsComposed(boundary, contentRoot),
	);
}

function isSemanticallyHidden(element) {
	for (let ancestor = element; ancestor; ancestor = composedParent(ancestor)) {
		if (ancestor.hasAttribute?.("inert")) {
			return true;
		}
		if (String(ancestor.getAttribute?.("aria-hidden") ?? "").toLowerCase() === "true") {
			return true;
		}
	}
	return false;
}

export function isReadablePlainTextRoot(element) {
	const documentRef = element.ownerDocument;
	const rootPre = element.matches("pre") ? element : element.closest("pre");
	return Boolean(
		rootPre?.parentElement === documentRef.body &&
		READABLE_PLAIN_TEXT_TYPES.has(String(documentRef.contentType).toLowerCase()),
	);
}

export function isOwnedNode(node) {
	const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement ?? node?.host ?? node?.getRootNode?.().host;
	return Boolean(
		element && closestComposed(element, OWNED_NODE_SELECTOR),
	);
}

export function forEachTextNode(node, callback) {
	if (node.nodeType === Node.TEXT_NODE) {
		callback(node);
		return;
	}
	if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(node.nodeType)) {
		return;
	}
	const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
	if (node.shadowRoot) forEachTextNode(node.shadowRoot, callback);
	for (let child = walker.nextNode(); child; child = walker.nextNode()) {
		if (child.nodeType === Node.TEXT_NODE) callback(child);
		if (child.shadowRoot) forEachTextNode(child.shadowRoot, callback);
	}
}

export function getUnownedTextContent(node) {
	if (!node?.ownerDocument) {
		return node?.textContent ?? "";
	}
	let text = "";
	forEachTextNode(node, (textNode) => {
		if (!isOwnedNode(textNode)) {
			text += textNode.textContent ?? "";
		}
	});
	return text;
}

export function sourceSelector(runId) {
	return `[data-bt-source="${CSS.escape(runId)}"]`;
}

export function normalizeText(value) {
	return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function getContentRootKey(root) {
	return [
		root.tagName ?? "",
		root.dataset?.testid ?? "",
		root.getAttribute?.("role") ?? "",
		root.getAttribute?.("lang") ?? "",
	].join("\u0000");
}

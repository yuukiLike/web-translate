import { SELECTORS } from "../constants.js";
import { findSiteTranslationLinkAnchor, SITE_PRESENTATION } from "../site-profile.js";
import { closestComposed, isOwnedNode } from "./node-utils.js";

const COMPACT_REGIONS = "nav, [role='navigation'], [role='toolbar'], [role='tablist'], [role='menu'], [role='menubar']";
const READING_BLOCKS = `${SELECTORS.leaf}, blockquote, figcaption, caption, td, th, dt, dd`;

/** 控件标签跟随原来的文字，正文保留段落；不把新行塞进固定高度的按钮。 */
export function placeFlowTranslation(source, translation, candidate, presentation) {
	if (presentation !== SITE_PRESENTATION.lineStartInline && isCompactLabel(source, candidate)) {
		translation.dataset.btLayout = "compact-inline";
		translation.title = translation.textContent;
		const label = source.ownerDocument.createElement("span");
		label.className = "bt-translation-label-text";
		label.dataset.btOwned = "true";
		label.textContent = `\u00a0·\u00a0${translation.textContent}`;
		translation.replaceChildren(label);
		const anchor = candidate.textAnchor;
		anchor.parentNode.insertBefore(translation, anchor.nextSibling);
		return;
	}
	const { partial, placementAnchor } = candidate;
	if (placementAnchor?.parentNode?.host === source) {
		placementAnchor.parentNode.insertBefore(translation, placementAnchor.nextSibling);
		return;
	}
	if (partial && placementAnchor !== source && placementAnchor.parentElement) {
		placementAnchor.parentElement.insertBefore(translation, placementAnchor.nextSibling);
		return;
	}
	const linkAnchor = presentation === SITE_PRESENTATION.lineStartInline ? null : findTranslationLinkAnchor(source);
	if (linkAnchor) {
		linkAnchor.append(translation);
		return;
	}
	if (source.matches("li, td, th, caption, summary, dt, dd, button, [role='button']")) {
		source.append(translation);
		return;
	}
	const sourceDisplay = getComputedStyle(source).display;
	if (sourceDisplay.startsWith("inline") || sourceDisplay === "contents") {
		source.append(translation);
		return;
	}
	const parentStyle = source.parentElement ? getComputedStyle(source.parentElement) : null;
	if (parentStyle && (parentStyle.display.includes("grid") ||
		(parentStyle.display.includes("flex") && !String(parentStyle.flexDirection).startsWith("column")))) {
		source.append(translation);
		return;
	}
	source.insertAdjacentElement("afterend", translation);
}

function isCompactLabel(source, candidate) {
	if (!candidate.textAnchor?.parentNode || candidate.text.length > 120 || candidate.text.includes("\n")) return false;
	const region = closestComposed(source, COMPACT_REGIONS);
	const header = closestComposed(source, "header, [role='banner']");
	const pageHeader = header && !closestComposed(header, SELECTORS.root);
	if (source.matches(READING_BLOCKS) && !region && !pageHeader) return false;
	if (candidate.controlAnchor || region || pageHeader) return true;
	const style = getComputedStyle(source);
	return style.display.startsWith("inline") || style.whiteSpace === "nowrap";
}

function findTranslationLinkAnchor(source) {
	let sharedAnchor = null;
	const walker = source.ownerDocument.createTreeWalker(source, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (isOwnedNode(node) || !/[\p{L}\p{N}]/u.test(node.textContent ?? "")) continue;
		const anchor = node.parentElement?.closest("a[href]");
		if (!anchor || !source.contains(anchor)) return findSiteTranslationLinkAnchor(source);
		if (sharedAnchor && anchor !== sharedAnchor) return findSiteTranslationLinkAnchor(source);
		sharedAnchor = anchor;
	}
	return sharedAnchor;
}

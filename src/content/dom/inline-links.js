import { getInlineLinkMarkers, stripInlineLinkMarkers } from "../../core/inline-link-markers.js";
import { closestComposed, containsComposed, textParent } from "./node-utils.js";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const LINK_CONTENT = /\[\[BT_LINK_(\d+)\]\]([\s\S]*?)\[\[\/BT_LINK_\1\]\]/gu;

/** 保留原文用于语言识别，同时为整句中的链接添加可回填标记。 */
export function serializeSourceText(core, entries, source, preserveLinks) {
	const fragments = [];
	let previous = null;
	for (const entry of entries) {
		const text = entry.text ?? entry.node.textContent ?? "";
		if (!text) continue;
		if (previous && !fragments.at(-1)?.text.endsWith("\n") &&
			(entry.order !== previous.order + 1 || entry.block !== previous.block)) {
			fragments.push({ text: "\n", link: null });
		}
		const link = closestComposed(textParent(entry.node), "a[href]");
		fragments.push({ text, link: link !== source && containsComposed(source, link) ? link : null });
		previous = entry;
	}
	const text = core.normalizeSourceText(fragments.map((fragment) => fragment.text).join(""));
	// 整个标签只有一个主链接时，译文本身已放在原链接内，无需创建嵌套链接。
	const hasProse = fragments.some((fragment) => !fragment.link && /[\p{L}\p{N}]/u.test(fragment.text));
	if (!preserveLinks || !hasProse || getInlineLinkMarkers(text).length) {
		return { text, translationText: text, inlineLinks: [] };
	}

	const inlineLinks = [];
	let translationText = "";
	let activeLink = null;
	let activeIndex = -1;
	for (const fragment of fragments) {
		if (fragment.link !== activeLink) {
			if (activeLink) translationText += `[[/BT_LINK_${activeIndex}]]`;
			activeLink = fragment.link;
			if (activeLink) {
				activeIndex = inlineLinks.length;
				inlineLinks.push(activeLink);
				translationText += `[[BT_LINK_${activeIndex}]]`;
			}
		}
		translationText += fragment.text;
	}
	if (activeLink) translationText += `[[/BT_LINK_${activeIndex}]]`;
	return { text, translationText: core.normalizeSourceText(translationText), inlineLinks };
}

/** 只创建来自源 DOM 的链接，模型输出始终通过 Text 节点显示。 */
export function appendTranslationContent(container, text, inlineLinks) {
	if (!inlineLinks.length) {
		container.append(text);
		return;
	}
	let offset = 0;
	for (const match of text.matchAll(LINK_CONTENT)) {
		container.append(stripInlineLinkMarkers(text.slice(offset, match.index)));
		const sourceLink = inlineLinks[Number(match[1])];
		container.append(createTranslationLink(container.ownerDocument, sourceLink, match[2]));
		offset = match.index + match[0].length;
	}
	container.append(stripInlineLinkMarkers(text.slice(offset)));
}

function createTranslationLink(documentRef, sourceLink, text) {
	if (!sourceLink || !SAFE_LINK_PROTOCOLS.has(sourceLink.protocol)) return documentRef.createTextNode(text);
	const link = documentRef.createElement("a");
	link.className = "bt-translation-link";
	link.href = sourceLink.href;
	const originalLabel = sourceLink.textContent.trim();
	const isReference = /^(?:#\d+|[a-f\d]{7,40}|(?:https?:\/\/|www\.)\S+)$/iu.test(originalLabel);
	link.textContent = isReference ? originalLabel : text;
	for (const attribute of ["target", "rel", "title"]) {
		const value = sourceLink.getAttribute(attribute);
		if (value !== null) link.setAttribute(attribute, value);
	}
	if (link.target === "_blank") link.relList.add("noopener");
	const style = getComputedStyle(sourceLink);
	if (style.color) link.style.setProperty("--bt-link-color", style.color);
	if (style.textDecorationLine) link.style.setProperty("--bt-link-decoration", style.textDecorationLine);
	return link;
}

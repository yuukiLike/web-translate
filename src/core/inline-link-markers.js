const INLINE_LINK_MARKER = /\[\[(\/?)BT_LINK_(\d+)\]\]/gu;

/** 链接地址留在 DOM 中；模型只接收带身份的行内文字。 */
export function getInlineLinkMarkers(text) {
	return [...String(text).matchAll(INLINE_LINK_MARKER)];
}

export function stripInlineLinkMarkers(text) {
	return String(text).replace(INLINE_LINK_MARKER, "");
}

export function preserveInlineLinkMarkerBoundary(text, cut) {
	const marker = getInlineLinkMarkers(text).find((item) =>
		item.index < cut && cut < item.index + item[0].length,
	);
	if (!marker) return cut;
	// 恢复拆批可能小于单个标记；此时让整个标记留在同一片中。
	return marker.index > 0 ? marker.index : marker[0].length;
}

export function haveSameInlineLinkMarkers(sourceText, translationText) {
	const expected = getInlineLinkMarkers(sourceText);
	const actual = getInlineLinkMarkers(translationText);
	return expected.length === actual.length && expected.every((marker, index) => marker[0] === actual[index][0]);
}

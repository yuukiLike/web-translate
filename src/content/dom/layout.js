import { PRIORITY } from "../constants.js";
import { isTranslationExcluded } from "./node-utils.js";
import { readableNodes } from "./text-walker.js";

/** 与布局有关的浏览器读取集中在此，避免扫描和监听器各自实现一套。 */
export class LayoutInspector {
	constructor(elementStore) {
		this.elementStore = elementStore;
	}

	getStyle(element, cache = null) {
		let style = cache?.get(element);
		if (!style) {
			style = getComputedStyle(element);
			cache?.set(element, style);
			this.remember(element, style);
		}
		return style;
	}

	remember(element, style) {
		if (!this.elementStore.hasLayoutSignature(element)) {
			this.elementStore.setLayoutSignature(element, getLayoutSignature(style));
		}
	}

	update(element) {
		const signature = getLayoutSignature(getComputedStyle(element));
		const previous = this.elementStore.getLayoutSignature(element);
		this.elementStore.setLayoutSignature(element, signature);
		return previous !== undefined && previous !== signature;
	}

	isEligible(element) {
		if (!element.isConnected || isTranslationExcluded(element)) {
			return false;
		}
		const style = getComputedStyle(element);
		this.remember(element, style);
		if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
			return false;
		}
		if (style.display !== "contents" && element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) {
			return false;
		}
		const rectangle = this.getRectangle(element);
		return rectangle.width > 1 && rectangle.height > 1;
	}

	getRectangle(element) {
		const rectangle = element.getBoundingClientRect();
		if (rectangle.width > 0 && rectangle.height > 0) return rectangle;
		// display:contents 没有元素盒，但其文本仍然可见。
		if (getComputedStyle(element).display !== "contents") return rectangle;
		for (const node of readableNodes(element)) {
			if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
			const range = element.ownerDocument.createRange();
			range.selectNodeContents(node);
			const textRectangle = range.getBoundingClientRect();
			if (textRectangle.width > 0 && textRectangle.height > 0) return textRectangle;
		}
		return rectangle;
	}

	getPriority(element) {
		const rectangle = this.getRectangle(element);
		const viewportHeight = Math.max(window.innerHeight, 1);
		if (rectangle.bottom >= -viewportHeight * 0.5 && rectangle.top <= viewportHeight * 1.5) {
			return Math.max(0, rectangle.top + viewportHeight * 0.5);
		}
		if (rectangle.top > viewportHeight * 1.5) {
			return PRIORITY.belowFold + rectangle.top;
		}
		return PRIORITY.aboveViewport + Math.abs(rectangle.bottom);
	}
}

function getLayoutSignature(style) {
	const display = String(style.display);
	if (display === "contents") {
		return "contents";
	}
	if (display.startsWith("inline-flex")) {
		return `inline-flex:${String(style.flexDirection)}`;
	}
	if (display.startsWith("inline-grid")) {
		return "inline-grid";
	}
	if (display.startsWith("inline")) {
		return "inline";
	}
	if (display.includes("flex")) {
		return `flex:${String(style.flexDirection)}`;
	}
	if (display.includes("grid")) {
		return "grid";
	}
	return "block";
}

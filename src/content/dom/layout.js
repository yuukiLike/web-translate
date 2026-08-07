import { PRIORITY, SELECTORS } from "../constants.js";
import { isTranslationExcluded } from "./node-utils.js";

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
		const rectangle = element.getBoundingClientRect();
		return rectangle.width > 1 && rectangle.height > 1;
	}

	getPriority(element) {
		const rectangle = element.getBoundingClientRect();
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

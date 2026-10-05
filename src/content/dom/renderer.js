import {
	findSiteTranslationLinkAnchor,
	SITE_PRESENTATION,
} from "../site-profile.js";
import { createGeneratedTranslation } from "./generated-presentation.js";
import { normalizeReadingSettings } from "../../core/reading-settings.js";
import { isOwnedNode } from "./node-utils.js";

/** 负责创建翻译节点、继承源样式并选择插入位置。 */
export class TranslationRenderer {
	constructor({ core, scanner, layout, elementStore, progress, invalidator, rootQueue, onNeedsRescan, reading }) {
		this.core = core;
		this.scanner = scanner;
		this.layout = layout;
		this.elementStore = elementStore;
		this.progress = progress;
		this.invalidator = invalidator;
		this.rootQueue = rootQueue;
		this.onNeedsRescan = onNeedsRescan;
		this.reading = normalizeReadingSettings(reading);
	}

	renderIfReady(record, runId) {
		if (
			record.rendered ||
			!record.element.isConnected ||
			record.translations.some((translation) => typeof translation !== "string")
		) {
			return;
		}
		const elementState = this.elementStore.getState(record.element);
		if (
			!elementState ||
			elementState.revision !== record.revision ||
			elementState.originalHash !== record.originalHash
		) {
			return;
		}

		const candidate = this.scanner.currentCandidate(record.element);
		if (!candidate || this.core.hashText(candidate.text) !== record.originalHash) {
			this.invalidator.invalidate(record.element);
			this.rootQueue.add(record.element);
			this.onNeedsRescan(runId);
			return;
		}

		const translationText = record.translations.join("\n").trim();
		const presentation = this.scanner.getPresentation(record.element);
		let translation = null;
		if (!isRedundantTranslation(this.core, candidate.text, translationText)) {
			translation = presentation === SITE_PRESENTATION.generated
				? createGeneratedTranslation({
						anchor: candidate.presentationAnchor,
						source: record.element,
						text: translationText,
						language: normalizeTargetLanguage(record.targetLanguage),
						runId,
					})
				: createFlowTranslation({
						renderer: this,
						source: record.element,
						text: translationText,
						targetLanguage: record.targetLanguage,
						runId,
						presentation,
						placementAnchor: candidate.placementAnchor,
						partial: candidate.partial,
					});
		}

		record.rendered = true;
		elementState.status = "translated";
		elementState.translationNode = translation;
		elementState.presentation = translation ? presentation ?? "flow" : "none";
		if (elementState.presentation === SITE_PRESENTATION.generated) {
			this.elementStore.generatedSources.add(record.element);
		}
		if (translation) {
			this.copySourcePresentation(record.element, translation);
			this.elementStore.rememberTranslationSource(translation, record.element);
		}
		this.progress.complete(record.element, record.progressKey);
	}

	copySourcePresentation(source, translation) {
		const sourceStyle = getComputedStyle(source);
		if (Number.parseInt(sourceStyle.webkitLineClamp, 10) > 0 ||
			(sourceStyle.whiteSpace === "nowrap" && translation.parentElement === source)) {
			source.dataset.btReadingLayout = "expand";
		}
		translation.dataset.btStyle = this.reading.style;
		translation.setAttribute("translate", "no");
		translation.dir = "auto";
		this.layout.remember(source, sourceStyle);
		const fontSize = Number.parseFloat(sourceStyle.fontSize);
		const fontScale = source.matches("h1, h2, h3, h4, h5, h6") ? 0.76 : 1;
		if (Number.isFinite(fontSize)) {
			translation.style.setProperty("--bt-source-font-size", `${fontSize * fontScale * this.reading.fontScale}px`);
		}
		translation.style.setProperty(
			"--bt-translation-line-height",
			String(this.reading.lineHeight),
		);
		const marginBottom = getTransferableMarginBottom(sourceStyle);
		translation.style.setProperty("--bt-source-margin-bottom", `${marginBottom}px`);
		const fontWeight = getTranslationFontWeight(sourceStyle.fontWeight);
		if (fontWeight) {
			translation.style.setProperty("--bt-translation-font-weight", fontWeight);
		}
		if (isHorizontalFlex(sourceStyle)) {
			translation.dataset.btControlLayout = "row-flex";
		}
		for (const [property, value] of [
			["--bt-source-color", sourceStyle.color],
			["--bt-source-font-family", sourceStyle.fontFamily],
			["--bt-source-text-align", sourceStyle.textAlign],
		]) {
			if (value) {
				translation.style.setProperty(property, value);
			}
		}
	}

	updateReading(reading, roots) {
		this.reading = normalizeReadingSettings(reading);
		for (const root of roots) {
			for (const translation of root.querySelectorAll(".bt-translation[data-bt-owned='true']")) {
				const source = this.elementStore.getTranslationSource(translation);
				if (source?.isConnected) this.copySourcePresentation(source, translation);
			}
		}
	}
}

function createFlowTranslation({
	renderer,
	source,
	text,
	targetLanguage,
	runId,
	presentation,
	placementAnchor,
	partial,
}) {
	const translation = document.createElement("span");
	translation.className = "bt-translation notranslate";
	translation.dataset.btOwned = "true";
	translation.dataset.btRun = runId;
	translation.lang = normalizeTargetLanguage(targetLanguage);
	if (presentation === SITE_PRESENTATION.lineStartInline) {
		translation.dataset.btLayout = SITE_PRESENTATION.lineStartInline;
		translation.append(document.createElement("br"), text);
	} else {
		translation.textContent = text;
	}
	if (source.parentElement) {
		renderer.layout.remember(source.parentElement, getComputedStyle(source.parentElement));
	}
	placeTranslation(source, translation, {
		partial,
		placementAnchor,
		presentation,
	});
	return translation;
}

function normalizeTargetLanguage(language) {
	return language === "zh" ? "zh-CN" : "en";
}

function isRedundantTranslation(core, sourceText, translationText) {
	return core.normalizeSourceText(sourceText) === core.normalizeSourceText(translationText);
}

function getTransferableMarginBottom(style) {
	const display = String(style.display);
	if (!display || display === "contents" || display.startsWith("inline")) {
		return 0;
	}
	return Math.max(0, Number.parseFloat(style.marginBottom) || 0);
}

function isHorizontalFlex(style) {
	return (
		String(style.display).includes("flex") &&
		!String(style.flexDirection).startsWith("column")
	);
}

function getTranslationFontWeight(value) {
	if (value === "normal") {
		return "500";
	}
	if (value === "bold") {
		return "700";
	}
	const numericWeight = Number.parseInt(value, 10);
	return Number.isFinite(numericWeight) ? String(Math.max(500, numericWeight)) : "";
}

function placeTranslation(
	source,
	translation,
	{ partial, placementAnchor, presentation },
) {
	if (placementAnchor?.parentNode?.host === source) {
		placementAnchor.parentNode.insertBefore(translation, placementAnchor.nextSibling);
		return;
	}
	if (partial && placementAnchor !== source && placementAnchor.parentElement) {
		if (placementAnchor.nodeType === Node.ELEMENT_NODE) {
			placementAnchor.insertAdjacentElement("afterend", translation);
		} else {
			placementAnchor.parentElement.insertBefore(translation, placementAnchor.nextSibling);
		}
		return;
	}
	const linkAnchor = presentation === SITE_PRESENTATION.lineStartInline
		? null
		: findTranslationLinkAnchor(source);
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
	if (
		parentStyle &&
		(parentStyle.display === "grid" ||
			(parentStyle.display.includes("flex") &&
				!String(parentStyle.flexDirection).startsWith("column")))
	) {
		source.append(translation);
		return;
	}
	source.insertAdjacentElement("afterend", translation);
}

function findTranslationLinkAnchor(source) {
	let sharedAnchor = null;
	const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (isOwnedNode(node)) continue;
		if (!/[\p{L}\p{N}]/u.test(node.textContent ?? "")) {
			continue;
		}
		const anchor = node.parentElement?.closest("a[href]");
		if (!anchor || !source.contains(anchor)) {
			return findSiteTranslationLinkAnchor(source);
		}
		if (sharedAnchor && anchor !== sharedAnchor) {
			return findSiteTranslationLinkAnchor(source);
		}
		sharedAnchor = anchor;
	}
	return sharedAnchor;
}

/** 负责创建翻译节点、继承源样式并选择插入位置。 */
export class TranslationRenderer {
	constructor({ core, scanner, layout, elementStore, progress, invalidator, rootQueue, onNeedsRescan }) {
		this.core = core;
		this.scanner = scanner;
		this.layout = layout;
		this.elementStore = elementStore;
		this.progress = progress;
		this.invalidator = invalidator;
		this.rootQueue = rootQueue;
		this.onNeedsRescan = onNeedsRescan;
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

		const translation = document.createElement("span");
		translation.className = "bt-translation";
		translation.dataset.btOwned = "true";
		translation.dataset.btRun = runId;
		translation.lang = record.targetLanguage === "zh" ? "zh-CN" : "en";
		translation.textContent = record.translations.join("\n");
		this.copySourcePresentation(record.element, translation);
		if (record.element.parentElement) {
			this.layout.remember(record.element.parentElement, getComputedStyle(record.element.parentElement));
		}
		placeTranslation(record.element, translation, candidate.placementAnchor, candidate.partial);

		record.rendered = true;
		elementState.status = "translated";
		elementState.translationNode = translation;
		this.elementStore.rememberTranslationSource(translation, record.element);
		this.progress.complete(record.element, record.progressKey);
	}

	copySourcePresentation(source, translation) {
		const sourceStyle = getComputedStyle(source);
		this.layout.remember(source, sourceStyle);
		const fontSize = Number.parseFloat(sourceStyle.fontSize);
		const fontScale = source.matches("h1, h2, h3, h4, h5, h6") ? 0.72 : 0.94;
		if (Number.isFinite(fontSize)) {
			translation.style.setProperty("--bt-source-font-size", `${fontSize * fontScale}px`);
		}
		for (const [property, value] of [
			["--bt-source-color", sourceStyle.color],
			["--bt-source-font-family", sourceStyle.fontFamily],
			["--bt-source-font-weight", sourceStyle.fontWeight],
			["--bt-source-line-height", sourceStyle.lineHeight],
			["--bt-source-text-align", sourceStyle.textAlign],
		]) {
			if (value) {
				translation.style.setProperty(property, value);
			}
		}
	}
}

function placeTranslation(source, translation, placementAnchor, partial) {
	if (partial && placementAnchor !== source && placementAnchor.parentElement) {
		if (placementAnchor.nodeType === Node.ELEMENT_NODE) {
			placementAnchor.insertAdjacentElement("afterend", translation);
		} else {
			placementAnchor.parentElement.insertBefore(translation, placementAnchor.nextSibling);
		}
		return;
	}
	if (source.matches("li, td, th, caption, summary, dt, dd, button, [role='button']")) {
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

import { SOURCE_PART_CHARACTER_LIMIT } from "../constants.js";
import { SITE_PRESENTATION } from "../site-profile.js";
import { isGeneratedPresentationIntact } from "../dom/generated-presentation.js";
import { shouldSkipCandidate } from "./content-filter.js";
import { getSegmentKey } from "./run-cache.js";

/** 从正文候选块生成去重后的翻译段落。 */
export class TranslationPlanner {
	#segmentSequence = 0;

	constructor({ core, scanner, layout, elementStore, progress, invalidator, settings, runId }) {
		this.core = core;
		this.scanner = scanner;
		this.layout = layout;
		this.elementStore = elementStore;
		this.progress = progress;
		this.invalidator = invalidator;
		this.settings = settings;
		this.runId = runId;
	}

	collectSegments(roots) {
		const records = this.scanner
			.collect(roots)
			.map((candidate) => this.#createRecord(candidate))
			.filter(Boolean)
			.sort((left, right) => left.priority - right.priority);
		const uniqueSegments = new Map();

		for (const record of records) {
			record.element.dataset.btSource = this.runId;
			this.progress.count(record.element, record.progressKey);
			record.parts.forEach((text, partIndex) => {
				const dedupeKey = getSegmentKey({
					sourceLanguage: record.sourceLanguage,
					targetLanguage: record.targetLanguage,
					text,
				});
				let segment = uniqueSegments.get(dedupeKey);
				if (!segment) {
					this.#segmentSequence += 1;
					segment = {
						id: `${this.runId}-${this.#segmentSequence.toString(36)}`,
						text,
						priority: record.priority,
						sourceLanguage: record.sourceLanguage,
						targetLanguage: record.targetLanguage,
						targets: [],
					};
					uniqueSegments.set(dedupeKey, segment);
				} else {
					segment.priority = Math.min(segment.priority, record.priority);
				}
				segment.targets.push({ record, partIndex });
			});
		}
		return [...uniqueSegments.values()].sort((left, right) => left.priority - right.priority);
	}

	#createRecord(candidate) {
		const { element, text } = candidate;
		const languagePair = this.#getLanguagePair(element, text);
		const originalHash = this.core.hashText(text);
		const existingState = this.elementStore.getState(element);
		if (
			existingState?.originalHash === originalHash &&
			existingState.sourceLanguage === languagePair.sourceLanguage &&
			existingState.targetLanguage === languagePair.targetLanguage &&
			this.#isExistingPresentationIntact(element, existingState)
		) {
			return null;
		}
		if (existingState) {
			this.invalidator.invalidate(element);
		}

		const revision = this.elementStore.nextRevision(element);
		if (!this.#shouldTranslate(candidate, languagePair)) {
			this.elementStore.setState(element, createSkippedState(originalHash, revision, languagePair));
			return null;
		}
		if (!this.layout.isEligible(element)) {
			this.elementStore.deferredElements.add(element);
			return null;
		}

		this.elementStore.deferredElements.delete(element);
		const parts = this.core.splitText(text, SOURCE_PART_CHARACTER_LIMIT);
		if (parts.length === 0) {
			return null;
		}
		const progressKey = [
			languagePair.sourceLanguage,
			languagePair.targetLanguage,
			originalHash,
		].join("\u0000");
		const record = {
			element,
			parts,
			translations: new Array(parts.length),
			originalHash,
			progressKey,
			revision,
			sourceLanguage: languagePair.sourceLanguage,
			targetLanguage: languagePair.targetLanguage,
			priority: this.layout.getPriority(element),
			rendered: false,
		};
		this.elementStore.setState(element, {
			originalHash,
			progressKey,
			revision,
			sourceLanguage: record.sourceLanguage,
			targetLanguage: record.targetLanguage,
			status: "queued",
			translationNode: null,
		});
		return record;
	}

	#isExistingPresentationIntact(element, state) {
		if (
			state.status !== "translated" ||
			state.presentation !== SITE_PRESENTATION.generated
		) {
			return true;
		}
		return isGeneratedPresentationIntact(
			element,
			state.translationNode,
			this.runId,
		);
	}

	#shouldTranslate(candidate, languagePair) {
		if (languagePair.sourceLanguage === languagePair.targetLanguage) {
			return false;
		}
		if (shouldSkipCandidate(candidate, this.settings.contentFilters)) {
			return false;
		}
		return this.core.shouldTranslateText(candidate.text, languagePair.targetLanguage);
	}

	#getLanguagePair(element, text) {
		let declaredElement = element;
		while (
			declaredElement &&
			declaredElement !== document.body &&
			declaredElement !== document.documentElement &&
			!declaredElement.getAttribute("lang")
		) {
			declaredElement = declaredElement.parentElement;
		}
		const declaredLanguage =
			declaredElement === document.body || declaredElement === document.documentElement
				? ""
				: declaredElement?.getAttribute("lang") || "";
		return this.core.getLanguagePair(
			declaredLanguage,
			text,
			this.settings.sourceMode,
			this.settings.targetMode,
		);
	}
}

function createSkippedState(originalHash, revision, languagePair) {
	return {
		originalHash,
		revision,
		sourceLanguage: languagePair.sourceLanguage,
		targetLanguage: languagePair.targetLanguage,
		status: "skipped",
		translationNode: null,
	};
}

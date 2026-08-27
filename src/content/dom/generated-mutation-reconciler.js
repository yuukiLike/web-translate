import { SITE_PRESENTATION } from "../site-profile.js";
import {
	isGeneratedPresentationIntact,
	restoreGeneratedPresentation,
} from "./generated-presentation.js";

/** 延迟复核 generated presentation，避免宿主的瞬时 mutation 造成译文缺口。 */
export class GeneratedMutationReconciler {
	#pendingSources = new Set();

	constructor({ runId, elementStore, scanner, invalidator, rootQueue }) {
		this.runId = runId;
		this.elementStore = elementStore;
		this.scanner = scanner;
		this.invalidator = invalidator;
		this.rootQueue = rootQueue;
	}

	queue(source) {
		const state = this.elementStore.getState(source);
		if (state?.presentation !== SITE_PRESENTATION.generated) {
			return this.#preservePendingTranslation(source, state);
		}
		for (const pending of this.#pendingSources) {
			if (pending === source) {
				continue;
			}
			const pendingState = this.elementStore.getState(pending);
			if (
				!pending.isConnected ||
				pendingState?.presentation !== SITE_PRESENTATION.generated
			) {
				this.#pendingSources.delete(pending);
				if (pendingState?.presentation === SITE_PRESENTATION.generated) {
					this.invalidator.invalidate(pending);
				}
			}
		}
		this.#pendingSources.add(source);
		if (source.isConnected) {
			this.rootQueue.add(source);
		}
		return true;
	}

	#preservePendingTranslation(source, state) {
		if (
			!source.isConnected ||
			state?.status !== "queued" ||
			!state.loading?.requests.size ||
			this.scanner.getPresentation(source) !== SITE_PRESENTATION.generated ||
			!this.scanner.matchesCurrentCandidate(source, state.originalHash)
		) {
			return false;
		}
		this.rootQueue.add(source);
		return true;
	}

	reconcile() {
		for (const source of this.#pendingSources) {
			const state = this.elementStore.getState(source);
			if (state?.presentation !== SITE_PRESENTATION.generated) {
				continue;
			}
			if (!source.isConnected) {
				this.invalidator.invalidate(source);
				continue;
			}
			if (!this.#restoreAtCurrentAnchor(source, state)) {
				this.invalidator.invalidate(source);
			}
			this.rootQueue.add(source);
		}
		this.#pendingSources.clear();
	}

	restoreAttributes(source) {
		const state = this.elementStore.getState(source);
		if (
			state?.presentation === SITE_PRESENTATION.generated &&
			!isGeneratedPresentationIntact(source, state.translationNode, this.runId)
		) {
			restoreGeneratedPresentation(source, state.translationNode, this.runId);
		}
	}

	/** 内层文本 carrier 被替换时，按最终 DOM 的新 anchor 同步复挂真实译文。 */
	recoverRemovedTranslation(node) {
		let recovered = false;
		for (const translation of findTrackedTranslations(this.elementStore, node)) {
			const source = this.elementStore.getTranslationSource(translation);
			const state = source ? this.elementStore.getState(source) : null;
			if (
				!source?.isConnected ||
				state?.translationNode !== translation ||
				state.presentation !== SITE_PRESENTATION.generated
			) {
				continue;
			}

			if (this.#restoreAtCurrentAnchor(source, state, translation)) {
				this.rootQueue.add(source);
				recovered = true;
				continue;
			}

			this.invalidator.invalidate(source);
			this.rootQueue.add(source);
			recovered = true;
		}
		return recovered;
	}

	/** 优先按 ElementStore 身份修复真实译文，避免宿主删掉 ownership 标记后失联。 */
	handleTrackedTranslationMutation(mutation) {
		const translation = findTrackedTranslation(
			this.elementStore,
			mutation.target,
		);
		const source = this.elementStore.getTranslationSource(translation);
		if (!source) {
			return null;
		}
		const state = this.elementStore.getState(source);
		if (state?.translationNode !== translation) {
			return null;
		}
		if (state.presentation !== SITE_PRESENTATION.generated || !source.isConnected) {
			return false;
		}
		if (
			restoreGeneratedPresentation(source, translation, this.runId) ||
			this.#restoreAtCurrentAnchor(source, state, translation)
		) {
			return false;
		}
		this.invalidator.invalidate(source);
		this.rootQueue.add(source);
		return true;
	}

	#restoreAtCurrentAnchor(source, state, translation = state.translationNode) {
		const candidate = this.scanner.currentCandidate(source);
		return Boolean(
			candidate &&
				this.scanner.core.hashText(candidate.text) === state.originalHash &&
				restoreGeneratedPresentation(
					source,
					translation,
					this.runId,
					candidate.presentationAnchor,
				),
		);
	}

	clear() {
		this.#pendingSources.clear();
	}
}

/** inner / Text 的 mutation 必须回溯到 ElementStore 追踪的 canonical outer。 */
function findTrackedTranslation(elementStore, node) {
	let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
	for (; element; element = element.parentElement) {
		if (elementStore.getTranslationSource(element)) {
			return element;
		}
	}
	return null;
}

/** 运行时 WeakMap 仍是权威来源，即使宿主先剥掉了译文的 DOM 标记。 */
function findTrackedTranslations(elementStore, node) {
	const root = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
	if (!root) {
		return [];
	}
	return [root, ...(root.querySelectorAll?.("*") ?? [])].filter((element) =>
		elementStore.getTranslationSource(element),
	);
}

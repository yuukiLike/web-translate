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
			return false;
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
			if (!this.scanner.matchesCurrentCandidate(source, state.originalHash)) {
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

	clear() {
		this.#pendingSources.clear();
	}
}

/** 单次翻译运行的元素索引。所有 WeakMap 都随运行结束一起释放。 */
export class ElementStore {
	#states = new WeakMap();
	#generations = new WeakMap();
	#layoutSignatures = new WeakMap();
	#textOwners = new WeakMap();
	#translationSources = new WeakMap();

	deferredElements = new Set();

	getState(element) {
		return this.#states.get(element);
	}

	hasState(element) {
		return this.#states.has(element);
	}

	setState(element, value) {
		this.#states.set(element, value);
	}

	deleteState(element) {
		this.#states.delete(element);
	}

	nextRevision(element) {
		const revision = (this.#generations.get(element) ?? 0) + 1;
		this.#generations.set(element, revision);
		return revision;
	}

	rememberTextOwner(textNode, element) {
		this.#textOwners.set(textNode, element);
	}

	getTextOwner(textNode) {
		return this.#textOwners.get(textNode);
	}

	rememberTranslationSource(translation, source) {
		this.#translationSources.set(translation, source);
	}

	getTranslationSource(translation) {
		return this.#translationSources.get(translation);
	}

	getLayoutSignature(element) {
		return this.#layoutSignatures.get(element);
	}

	setLayoutSignature(element, signature) {
		this.#layoutSignatures.set(element, signature);
	}

	hasLayoutSignature(element) {
		return this.#layoutSignatures.has(element);
	}

	findTrackedAncestor(node) {
		let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		for (; element; element = element.parentElement) {
			if (this.#states.has(element)) {
				return element;
			}
		}
		return null;
	}
}

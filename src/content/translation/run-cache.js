import { RUN_TRANSLATION_CACHE_LIMIT } from "../constants.js";

/** 单次运行内的 LRU 缓存；跨运行持久缓存由 service worker 负责。 */
export class RunTranslationCache {
	#entries = new Map();

	has(segment) {
		return this.#entries.has(getSegmentKey(segment));
	}

	get(segment) {
		return this.#entries.get(getSegmentKey(segment));
	}

	set(segment, translation) {
		const key = getSegmentKey(segment);
		this.#entries.delete(key);
		this.#entries.set(key, translation);
		if (this.#entries.size > RUN_TRANSLATION_CACHE_LIMIT) {
			const oldestKey = this.#entries.keys().next().value;
			this.#entries.delete(oldestKey);
		}
	}

	clear() {
		this.#entries.clear();
	}
}

export function getSegmentKey(segment) {
	return `${segment.sourceLanguage}\u0000${segment.targetLanguage}\u0000${segment.text}`;
}

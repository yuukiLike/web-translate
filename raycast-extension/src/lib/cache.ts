import { Cache } from "@raycast/api";

import { CACHE_CAPACITY_BYTES, TranslationCache } from "./cache-core.ts";
export type { TranslationCacheRequest } from "./cache-core.ts";

const CACHE_NAMESPACE = "translations-v1";

let defaultCache: TranslationCache | undefined;

export function getTranslationCache(): TranslationCache {
	defaultCache ??= new TranslationCache(
		new Cache({ namespace: CACHE_NAMESPACE, capacity: CACHE_CAPACITY_BYTES }),
	);
	return defaultCache;
}

export function clearTranslationCache(): void {
	getTranslationCache().clear();
}

import assert from "node:assert/strict";
import test from "node:test";

import {
	CACHE_CAPACITY_BYTES,
	CACHE_TTL_MS,
	TranslationCache,
	createTranslationCacheKey,
	type StringCacheStore,
	type TranslationCacheRequest,
} from "../src/lib/cache-core.ts";
import { normalizePreferences } from "../src/lib/core.ts";

class MemoryCacheStore implements StringCacheStore {
	readonly values = new Map<string, string>();

	get(key: string): string | undefined {
		return this.values.get(key);
	}

	set(key: string, value: string): void {
		this.values.set(key, value);
	}

	remove(key: string): boolean {
		return this.values.delete(key);
	}

	clear(): void {
		this.values.clear();
	}
}

function createRequest(): TranslationCacheRequest {
	return {
		preferences: normalizePreferences({
			provider: "deepseek",
			deepseekApiKey: "sk-cache-test",
		}),
		sourceLanguage: "en",
		targetLanguage: "zh",
		sourceText: "cache this source",
	};
}

test("uses a 10 MB Raycast cache capacity and opaque scoped keys", () => {
	const request = createRequest();
	const key = createTranslationCacheKey(request);

	assert.equal(CACHE_CAPACITY_BYTES, 10 * 1_024 * 1_024);
	assert.match(key, /^[a-f0-9]{64}$/u);
	assert.equal(key.includes(request.sourceText), false);
	assert.notEqual(
		key,
		createTranslationCacheKey({ ...request, targetLanguage: "en", sourceLanguage: "zh" }),
	);
	assert.notEqual(
		key,
		createTranslationCacheKey({
			...request,
			preferences: normalizePreferences({ provider: "openai", openaiApiKey: "sk-test" }),
		}),
	);
});

test("returns valid entries for 90 days and removes expired or corrupt entries", () => {
	const store = new MemoryCacheStore();
	const request = createRequest();
	let now = 1_800_000_000_000;
	const cache = new TranslationCache(store, () => now);

	cache.set(request, "缓存译文");
	assert.equal(cache.get(request), "缓存译文");

	now += CACHE_TTL_MS;
	assert.equal(cache.get(request), "缓存译文");
	now += 1;
	assert.equal(cache.get(request), undefined);
	assert.equal(store.values.size, 0);

	store.set(createTranslationCacheKey(request), "not-json");
	assert.equal(cache.get(request), undefined);
	assert.equal(store.values.size, 0);
});

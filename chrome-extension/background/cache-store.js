import { CACHE_LIMITS, STORAGE_KEYS } from "./constants.js";
import {
	createSerialTaskQueue,
	estimateStorageBytes,
	numberOrZero,
} from "./utilities.js";

export function createCacheStore({ chrome, core }) {
	let generation = 0;
	const writeQueue = createSerialTaskQueue();

	async function initialize() {
		const stored = await chrome.storage.session.get(STORAGE_KEYS.cacheGeneration);
		generation = numberOrZero(stored[STORAGE_KEYS.cacheGeneration]);
	}

	function getGeneration() {
		return generation;
	}

	async function lookup(settings, sourceLanguage, targetLanguage, segments, cacheScope) {
		const keyedSegments = segments.map((segment) => ({
			segment,
			key: core.cacheKey(
				settings,
				sourceLanguage,
				targetLanguage,
				segment.text,
				cacheScope,
			),
		}));
		const stored = await chrome.storage.local.get(keyedSegments.map(({ key }) => key));
		const now = Date.now();
		const results = new Map();
		let hasExpiredEntry = false;
		for (const { segment, key } of keyedSegments) {
			const entry = stored[key];
			if (isFreshEntry(entry, now, segment.text.length)) {
				results.set(segment.id, entry.translation);
			} else if (entry) {
				hasExpiredEntry = true;
			}
		}
		if (hasExpiredEntry) {
			void queueMaintenance().catch(() => {});
		}
		return results;
	}

	function store(
		settings,
		sourceLanguage,
		targetLanguage,
		entries,
		cacheScope,
		expectedGeneration,
	) {
		return writeQueue.run(() =>
			storeNow(
				settings,
				sourceLanguage,
				targetLanguage,
				entries,
				cacheScope,
				expectedGeneration,
			),
		);
	}

	async function storeNow(
		settings,
		sourceLanguage,
		targetLanguage,
		entries,
		cacheScope,
		expectedGeneration,
	) {
		if (expectedGeneration !== generation) {
			return;
		}
		const now = Date.now();
		const values = {};
		const keys = [];
		const seenKeys = new Set();
		for (const entry of entries) {
			const key = core.cacheKey(
				settings,
				sourceLanguage,
				targetLanguage,
				entry.text,
				cacheScope,
			);
			if (!seenKeys.has(key)) {
				keys.push(key);
				seenKeys.add(key);
			}
			values[key] = { translation: entry.translation, savedAt: now };
		}

		const storedIndex = await chrome.storage.local.get(core.CACHE_INDEX_KEY);
		const oldIndex = normalizeIndex(storedIndex[core.CACHE_INDEX_KEY]);
		const freshEntries = await getFreshEntries(oldIndex, now);
		const newKeySet = new Set(keys);
		const index = [...keys, ...freshEntries.keys()].filter(
			(key, position) => !newKeySet.has(key) || position < keys.length,
		);
		const overflow = new Set(index.splice(CACHE_LIMITS.maxEntries));
		const currentBytes = await chrome.storage.local.getBytesInUse(null);
		const replacingBytes = await chrome.storage.local.getBytesInUse([
			...keys,
			core.CACHE_INDEX_KEY,
		]);

		while (index.length > 0) {
			values[core.CACHE_INDEX_KEY] = index;
			const incomingBytes = estimateStorageBytes(values);
			const removedBytes = [...overflow].reduce(
				(sum, key) => sum + estimateStorageBytes({ [key]: freshEntries.get(key) }),
				0,
			);
			if (
				currentBytes - replacingBytes - removedBytes + incomingBytes <=
				CACHE_LIMITS.maxBytes
			) {
				break;
			}
			const candidate = index.at(-1);
			if (newKeySet.has(candidate)) {
				return;
			}
			index.pop();
			overflow.add(candidate);
		}

		values[core.CACHE_INDEX_KEY] = index;
		if (overflow.size > 0) {
			await chrome.storage.local.remove([...overflow]);
		}
		if (expectedGeneration === generation) {
			await chrome.storage.local.set(values);
		}
	}

	async function getFreshEntries(index, now = Date.now()) {
		const uniqueIndex = [...new Set(index)];
		const stored = uniqueIndex.length > 0 ? await chrome.storage.local.get(uniqueIndex) : {};
		const freshEntries = new Map();
		const expired = [];
		for (const key of uniqueIndex) {
			const entry = stored[key];
			if (isFreshEntry(entry, now)) {
				freshEntries.set(key, entry);
			} else {
				expired.push(key);
			}
		}
		if (expired.length > 0) {
			await chrome.storage.local.remove(expired);
		}
		return freshEntries;
	}

	function queueMaintenance() {
		return writeQueue.run(pruneNow);
	}

	async function pruneNow() {
		const stored = await chrome.storage.local.get(null);
		const oldIndex = normalizeIndex(stored[core.CACHE_INDEX_KEY]);
		const indexedKeys = new Set(oldIndex);
		const orphanedKeys = Object.keys(stored).filter(
			(key) => key.startsWith(core.CACHE_PREFIX) && !indexedKeys.has(key),
		);
		const freshEntries = await getFreshEntries([...oldIndex, ...orphanedKeys]);
		const index = [...freshEntries.keys()];
		const overflow = new Set(index.splice(CACHE_LIMITS.maxEntries));
		let totalBytes = await chrome.storage.local.getBytesInUse(null);
		while (index.length > 0 && totalBytes > CACHE_LIMITS.maxBytes) {
			const key = index.pop();
			overflow.add(key);
			totalBytes -= estimateStorageBytes({ [key]: freshEntries.get(key) });
		}
		await chrome.storage.local.set({ [core.CACHE_INDEX_KEY]: index });
		if (overflow.size > 0) {
			await chrome.storage.local.remove([...overflow]);
		}
	}

	async function clear() {
		generation += 1;
		await chrome.storage.session.set({ [STORAGE_KEYS.cacheGeneration]: generation });
		return await writeQueue.run(async () => {
			const stored = await chrome.storage.local.get(null);
			const keys = Object.keys(stored).filter(
				(key) => key === core.CACHE_INDEX_KEY || key.startsWith(core.CACHE_PREFIX),
			);
			if (keys.length > 0) {
				await chrome.storage.local.remove(keys);
			}
			return keys.length;
		});
	}

	function isFreshEntry(entry, now, sourceLength) {
		return (
			core.isRecord(entry) &&
			typeof entry.translation === "string" &&
			(sourceLength === undefined ||
				entry.translation.length <= core.getMaximumTranslationLength(sourceLength)) &&
			typeof entry.savedAt === "number" &&
			now - entry.savedAt <= CACHE_LIMITS.ttlMs
		);
	}

	function normalizeIndex(value) {
		return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
	}

	return { clear, getGeneration, initialize, lookup, queueMaintenance, store };
}

import { LocalStorage } from "@raycast/api";

import { parseStoredDebugEvents, sanitizeDebugEvent, trimDebugEvents } from "./debug-core.ts";
import type { DebugEvent } from "./types.ts";
export { sanitizeEndpoint } from "./debug-core.ts";

const DEBUG_EVENTS_KEY = "translation-debug-events-v1";

interface DebugStorage {
	getItem(key: string): Promise<string | undefined>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
}

const storage: DebugStorage = {
	getItem: (key) => LocalStorage.getItem<string>(key),
	setItem: (key, value) => LocalStorage.setItem(key, value),
	removeItem: (key) => LocalStorage.removeItem(key),
};

let debugWriteQueue: Promise<void> = Promise.resolve();

export function recordDebugEvent(enabled: boolean, input: unknown): Promise<void> {
	if (!enabled) {
		return Promise.resolve();
	}
	const task = debugWriteQueue.then(async () => {
		const events = parseStoredDebugEvents(await storage.getItem(DEBUG_EVENTS_KEY));
		events.push(sanitizeDebugEvent(input));
		await storage.setItem(DEBUG_EVENTS_KEY, JSON.stringify(trimDebugEvents(events)));
	});
	debugWriteQueue = task.catch(() => undefined);
	return task;
}

export async function getDebugEvents(): Promise<readonly DebugEvent[]> {
	await debugWriteQueue;
	return parseStoredDebugEvents(await storage.getItem(DEBUG_EVENTS_KEY));
}

export function clearDebugEvents(): Promise<void> {
	const task = debugWriteQueue.then(() => storage.removeItem(DEBUG_EVENTS_KEY));
	debugWriteQueue = task.catch(() => undefined);
	return task;
}

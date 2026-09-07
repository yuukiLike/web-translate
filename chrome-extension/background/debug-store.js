import {
	DEBUG_LIMITS,
	DEBUG_PORT_NAME,
	STORAGE_KEYS,
} from "./constants.js";
import { createSafeDebugEvent } from "./debug-event-sanitizer.js";
import {
	createIdentifier,
	createSerialTaskQueue,
	estimateStorageBytes,
	numberOrZero,
} from "./utilities.js";

export function createDebugStore({ chrome, core, getSafeEndpoint }) {
	const ports = new Set();
	const workerInstanceId = createIdentifier();
	let events = [];
	let nextSequence = 1;
	let droppedEvents = 0;
	let enabled = false;
	let requestPayloadEnabled = false;
	let ready;
	const writeQueue = createSerialTaskQueue();

	function initialize(initialEnabled, initialRequestPayloadEnabled = false) {
		enabled = initialEnabled === true;
		requestPayloadEnabled = initialRequestPayloadEnabled === true;
		ready ??= loadStoredEvents();
		return ready;
	}

	function setEnabled(nextEnabled) {
		enabled = nextEnabled === true;
	}

	function setRequestPayloadEnabled(nextEnabled) {
		requestPayloadEnabled = nextEnabled === true;
		if (requestPayloadEnabled || !ready) {
			return Promise.resolve();
		}
		return scrubRequestPayloads();
	}

	function record(event) {
		if (!enabled || !core.isRecord(event)) {
			return;
		}
		writeQueue.run(async () => {
			await initialize(enabled, requestPayloadEnabled);
			if (!enabled) {
				return;
			}
			const safeEvent = createSafeEvent({
				...event,
				seq: nextSequence,
				timestamp: new Date().toISOString(),
				workerInstanceId,
			});
			nextSequence += 1;
			events.push(safeEvent);
			const previousDropped = droppedEvents;
			trimEvents();
			await persistEvents();
			broadcast(droppedEvents > previousDropped
				? { type: "DEBUG_SNAPSHOT", events, retention: getRetention() }
				: { type: "DEBUG_EVENT", event: safeEvent, retention: getRetention() });
		});
	}

	function recordRequest(context, event) {
		if (core.isRecord(context)) {
			record({ ...context, ...event });
		}
	}

	async function getEvents() {
		await initialize(enabled, requestPayloadEnabled);
		await writeQueue.wait();
		return events.map((event) => structuredClone(event));
	}

	async function getSnapshot() {
		await initialize(enabled, requestPayloadEnabled);
		return writeQueue.run(() => ({ events: structuredClone(events), retention: getRetention() }));
	}

	function getRetention() {
		return {
			droppedEvents,
			retainedEvents: events.length,
			retainedBytes: estimateStorageBytes(events),
			maxEvents: DEBUG_LIMITS.maxEvents,
			maxBytes: DEBUG_LIMITS.maxBytes,
		};
	}

	async function clear() {
		await initialize(enabled, requestPayloadEnabled);
		const task = writeQueue.run(async () => {
			events = [];
			droppedEvents = 0;
			await chrome.storage.session.remove([STORAGE_KEYS.debugEvents, STORAGE_KEYS.debugRetention]).catch(() => {});
			broadcast({ type: "DEBUG_RESET", retention: getRetention() });
		});
		await task;
	}

	function connect(port, isExtensionPageUrl, storageReady = Promise.resolve()) {
		if (port.name !== DEBUG_PORT_NAME || !isExtensionPageUrl(port.sender?.url)) {
			port.disconnect();
			return;
		}
		let connected = true;
		port.onDisconnect.addListener(() => {
			connected = false;
			ports.delete(port);
		});
		port.onMessage.addListener((message) => {
			if (core.isRecord(message) && message.type === "DEBUG_PING") {
				postToPort(port, { type: "DEBUG_PONG" });
			}
		});
		void storageReady
			.then(() => initialize(enabled, requestPayloadEnabled))
			.then(() => writeQueue.run(() => {
				if (!connected) return;
				// Subscribe in the same queue turn as the snapshot so no event can precede it.
				ports.add(port);
				postToPort(port, { type: "DEBUG_SNAPSHOT", events, retention: getRetention() });
			}))
			.catch(() => {
				ports.delete(port);
				port.disconnect();
			});
	}

	async function loadStoredEvents() {
		const stored = await chrome.storage.session.get([STORAGE_KEYS.debugEvents, STORAGE_KEYS.debugRetention]).catch(() => ({}));
		const storedEvents = Array.isArray(stored[STORAGE_KEYS.debugEvents])
			? stored[STORAGE_KEYS.debugEvents]
			: [];
		droppedEvents = Math.max(0, Math.round(numberOrZero(stored[STORAGE_KEYS.debugRetention]?.droppedEvents)));
		events = storedEvents
			.filter((event) => core.isRecord(event))
			.map((event) => createSafeEvent(event));
		trimEvents();
		nextSequence =
			events.reduce((maximum, event) => Math.max(maximum, numberOrZero(event.seq)), 0) + 1;
		if (JSON.stringify(events) !== JSON.stringify(storedEvents)) {
			await persistEvents();
		}
	}

	function createSafeEvent(event) {
		return createSafeDebugEvent(event, requestPayloadEnabled);
	}

	function scrubRequestPayloads() {
		return writeQueue.run(async () => {
			await ready;
			const scrubbed = events.map((event) => createSafeEvent(event));
			if (JSON.stringify(scrubbed) === JSON.stringify(events)) {
				return;
			}
			events = scrubbed;
			trimEvents();
			await persistEvents();
			broadcast({ type: "DEBUG_SNAPSHOT", events, retention: getRetention() });
		});
	}

	async function persistEvents() {
		if (events.length === 0) {
			await chrome.storage.session.remove([STORAGE_KEYS.debugEvents, STORAGE_KEYS.debugRetention]).catch(() => {});
			return;
		}
		await chrome.storage.session.set({
			[STORAGE_KEYS.debugEvents]: events,
			[STORAGE_KEYS.debugRetention]: { droppedEvents },
		}).catch(() => {});
	}

	function trimEvents() {
		if (events.length > DEBUG_LIMITS.maxEvents) {
			droppedEvents += events.length - DEBUG_LIMITS.maxEvents;
			events = events.slice(-DEBUG_LIMITS.maxEvents);
		}
		while (events.length > 0 && estimateStorageBytes(events) > DEBUG_LIMITS.maxBytes) {
			events.shift();
			droppedEvents += 1;
		}
	}

	function broadcast(message) {
		for (const port of ports) {
			postToPort(port, message);
		}
	}

	function postToPort(port, message) {
		try {
			port.postMessage(message);
		} catch {
			ports.delete(port);
		}
	}

	return {
		clear,
		connect,
		getEvents,
		getSnapshot,
		getSafeEndpoint,
		initialize,
		record,
		recordRequest,
		setEnabled,
		setRequestPayloadEnabled,
	};
}

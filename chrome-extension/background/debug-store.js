import {
	DEBUG_BOOLEAN_FIELDS,
	DEBUG_LIMITS,
	DEBUG_NUMBER_FIELDS,
	DEBUG_PORT_NAME,
	DEBUG_STRING_FIELDS,
	STORAGE_KEYS,
} from "./constants.js";
import { createSafeRequestPayload } from "./request-payload-sanitizer.js";
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
			trimEvents();
			await persistEvents();
			broadcast({ type: "DEBUG_EVENT", event: safeEvent });
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

	async function clear() {
		await initialize(enabled, requestPayloadEnabled);
		const task = writeQueue.run(async () => {
			events = [];
			await chrome.storage.session.remove(STORAGE_KEYS.debugEvents).catch(() => {});
			broadcast({ type: "DEBUG_RESET" });
		});
		await task;
	}

	function connect(port, isExtensionPageUrl, storageReady = Promise.resolve()) {
		if (port.name !== DEBUG_PORT_NAME || !isExtensionPageUrl(port.sender?.url)) {
			port.disconnect();
			return;
		}
		ports.add(port);
		port.onDisconnect.addListener(() => ports.delete(port));
		port.onMessage.addListener((message) => {
			if (core.isRecord(message) && message.type === "DEBUG_PING") {
				postToPort(port, { type: "DEBUG_PONG" });
			}
		});
		void storageReady
			.then(() => getEvents())
			.then((storedEvents) => {
				postToPort(port, { type: "DEBUG_SNAPSHOT", events: storedEvents });
			})
			.catch(() => {
				ports.delete(port);
				port.disconnect();
			});
	}

	async function loadStoredEvents() {
		const stored = await chrome.storage.session.get(STORAGE_KEYS.debugEvents).catch(() => ({}));
		const storedEvents = Array.isArray(stored[STORAGE_KEYS.debugEvents])
			? stored[STORAGE_KEYS.debugEvents]
			: [];
		events = storedEvents
			.filter((event) => core.isRecord(event))
			.map((event) => createSafeEvent(event))
			.slice(-DEBUG_LIMITS.maxEvents);
		trimEvents();
		nextSequence =
			events.reduce((maximum, event) => Math.max(maximum, numberOrZero(event.seq)), 0) + 1;
		if (JSON.stringify(events) !== JSON.stringify(storedEvents)) {
			await persistEvents();
		}
	}

	function createSafeEvent(event) {
		const safe = {};
		for (const field of DEBUG_STRING_FIELDS) {
			if (typeof event[field] === "string" && event[field]) {
				safe[field] = event[field].slice(0, field === "endpoint" ? 2_048 : 300);
			}
		}
		for (const field of DEBUG_NUMBER_FIELDS) {
			if (typeof event[field] === "number" && Number.isFinite(event[field])) {
				safe[field] = Math.max(0, Math.round(event[field]));
			}
		}
		for (const field of DEBUG_BOOLEAN_FIELDS) {
			if (typeof event[field] === "boolean") {
				safe[field] = event[field];
			}
		}
		if (
			requestPayloadEnabled &&
			event.requestPayloadAllowed === true &&
			event.incognito === false &&
			safe.provider === "deepseek" &&
			safe.eventType === "sdk.request-start"
		) {
			const result = createSafeRequestPayload(event.requestBody ?? event.requestPayload);
			if (result) {
				safe.requestPayloadAllowed = true;
				safe.incognito = false;
				safe.requestPayload = result.payload;
				if (result.truncated || event.requestPayloadTruncated === true) {
					safe.requestPayloadTruncated = true;
				}
			}
		}
		return safe;
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
			broadcast({ type: "DEBUG_SNAPSHOT", events });
		});
	}

	async function persistEvents() {
		if (events.length === 0) {
			await chrome.storage.session.remove(STORAGE_KEYS.debugEvents).catch(() => {});
			return;
		}
		await chrome.storage.session.set({ [STORAGE_KEYS.debugEvents]: events }).catch(() => {});
	}

	function trimEvents() {
		if (events.length > DEBUG_LIMITS.maxEvents) {
			events = events.slice(-DEBUG_LIMITS.maxEvents);
		}
		while (events.length > 0 && estimateStorageBytes(events) > DEBUG_LIMITS.maxBytes) {
			events.shift();
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
		getSafeEndpoint,
		initialize,
		record,
		recordRequest,
		setEnabled,
		setRequestPayloadEnabled,
	};
}

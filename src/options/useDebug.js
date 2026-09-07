import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

import { isRecord } from "../core/value-utils.js";
import { createSafeDebugEvent } from "../../chrome-extension/background/debug-event-sanitizer.js";
import { normalizeDebugEvents } from "./debugFormat.js";
import { createDebugRequests, createDebugRows } from "./debugRows.js";
import { createDebugTraces } from "./debugTraces.js";
import { errorText } from "./formatters.js";

const DEBUG_PORT_NAME = "debug-events-v1";
const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 1_000;

export function useDebug({ enabled, saved, captureEnabled, runtime, sendMessage }) {
	const events = ref([]);
	const rows = computed(() => createDebugRows(events.value));
	const requests = computed(() => createDebugRequests(events.value));
	const traces = computed(() => createDebugTraces(events.value, requests.value));
	const retention = ref({ droppedEvents: 0, retainedEvents: 0, retainedBytes: 0 });
	const connection = reactive({ text: "调试已关闭", state: "off" });
	let revision = 0;
	let port;
	let reconnectTimer;
	let heartbeatTimer;
	let disposed = false;

	function setConnection(text, state) {
		connection.text = text;
		connection.state = state;
	}

	function isVisible() {
		return typeof document === "undefined" || document.visibilityState === "visible";
	}

	function clearReconnect() {
		clearTimeout(reconnectTimer);
		reconnectTimer = undefined;
	}

	function clearHeartbeat() {
		clearInterval(heartbeatTimer);
		heartbeatTimer = undefined;
	}

	function updateHeartbeat() {
		clearHeartbeat();
		if (!port || !enabled.value || !isVisible() || disposed) {
			return;
		}
		heartbeatTimer = setInterval(() => {
			try {
				port?.postMessage({ type: "DEBUG_PING" });
			} catch {
				// The port's onDisconnect listener owns status and reconnection.
			}
		}, HEARTBEAT_INTERVAL_MS);
	}

	function acceptRetention(value) {
		if (!isRecord(value)) return;
		retention.value = Object.fromEntries(
			["droppedEvents", "retainedEvents", "retainedBytes", "maxEvents", "maxBytes"].map((key) =>
				[key, Number.isFinite(value[key]) ? Math.max(0, value[key]) : 0],
			),
		);
	}

	function replaceEvents(value) {
		revision += 1;
		const normalized = normalizeDebugEvents(value);
		events.value = captureEnabled.value ? normalized : normalized.map((event) => createSafeDebugEvent(event, false));
	}

	function appendEvent(event) {
		if (!isRecord(event)) {
			return;
		}
		revision += 1;
		const previous = events.value.filter((item) =>
			item.seq !== event.seq || item.workerInstanceId !== event.workerInstanceId || !event.seq,
		);
		const safe = captureEnabled.value ? event : createSafeDebugEvent(event, false);
		events.value = normalizeDebugEvents([...previous, safe]);
	}

	function handlePortMessage(message) {
		if (!isRecord(message)) {
			return;
		}
		acceptRetention(message.retention);
		if (message.type === "DEBUG_EVENT") {
			appendEvent(message.event);
			return;
		}
		if (message.type === "DEBUG_SNAPSHOT") {
			replaceEvents(message.events);
			return;
		}
		if (message.type === "DEBUG_RESET") {
			replaceEvents([]);
			retention.value = { droppedEvents: 0, retainedEvents: 0, retainedBytes: 0 };
		}
	}

	function handlePortDisconnect(disconnectedPort) {
		void runtime?.lastError;
		if (port !== disconnectedPort) {
			return;
		}
		port = undefined;
		clearHeartbeat();
		if (disposed || !enabled.value) {
			return;
		}
		setConnection("调试连接已断开", "error");
		if (isVisible()) {
			clearReconnect();
			reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
		}
	}

	function connect() {
		if (port || disposed || !enabled.value) {
			return Boolean(port);
		}
		clearReconnect();
		try {
			const nextPort = runtime.connect({ name: DEBUG_PORT_NAME });
			port = nextPort;
			nextPort.onMessage.addListener((message) => {
				if (port === nextPort) handlePortMessage(message);
			});
			nextPort.onDisconnect.addListener(() => handlePortDisconnect(nextPort));
			updateHeartbeat();
			setConnection("实时调试已连接", "connected");
			return true;
		} catch (error) {
			setConnection(errorText(error), "error");
			return false;
		}
	}

	function disconnect() {
		clearReconnect();
		clearHeartbeat();
		if (!port) {
			return;
		}
		const activePort = port;
		port = undefined;
		try {
			activePort.disconnect();
		} catch {
			// A disconnected extension port needs no further cleanup.
		}
	}

	async function sync() {
		if (!enabled.value || disposed) {
			return;
		}
		try {
			const requestedRevision = revision;
			const response = await sendMessage({ type: "GET_DEBUG_LOGS" });
			// A live update or reset supersedes an older in-flight snapshot.
			if (requestedRevision !== revision) return;
			replaceEvents(response.events);
			acceptRetention(response.retention);
		} catch (error) {
			setConnection(errorText(error), "error");
		}
	}

	async function clear() {
		try {
			const requestedRevision = revision;
			await sendMessage({ type: "CLEAR_DEBUG_LOGS" });
			if (revision === requestedRevision) {
				replaceEvents([]);
				retention.value = { droppedEvents: 0, retainedEvents: 0, retainedBytes: 0 };
			}
			if (!enabled.value) {
				setConnection("事件已清空", "off");
				return true;
			}
			setConnection("事件已清空，实时调试已连接", "connected");
			return true;
		} catch (error) {
			setConnection(errorText(error), "error");
			return false;
		}
	}

	function updateEnabled() {
		if (!enabled.value) {
			disconnect();
			setConnection("调试已关闭", "off");
			return;
		}
		connect();
		void sync();
	}

	function updateSaved() {
		if (!enabled.value) {
			setConnection("调试已关闭", "off");
			return;
		}
		if (!port && !connect()) {
			return;
		}
		setConnection("实时调试已连接", "connected");
	}

	function handleVisibilityChange() {
		if (!enabled.value || disposed) {
			return;
		}
		if (isVisible()) {
			connect();
			updateHeartbeat();
			void sync();
			return;
		}
		clearHeartbeat();
	}

	watch(enabled, updateEnabled, { immediate: true });
	watch(saved, updateSaved);
	// Revocation must clear open details even after the event port disconnects.
	watch(captureEnabled, (allowed) => {
		if (!allowed) replaceEvents(events.value);
	}, { flush: "sync" });

	onMounted(() => {
		document.addEventListener("visibilitychange", handleVisibilityChange);
		window.addEventListener("beforeunload", disconnect);
	});

	onBeforeUnmount(() => {
		disposed = true;
		document.removeEventListener("visibilitychange", handleVisibilityChange);
		window.removeEventListener("beforeunload", disconnect);
		disconnect();
	});

	return { rows, requests, traces, retention, connection, clear };
}

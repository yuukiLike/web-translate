import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

import { createDebugRows, errorText, isRecord, normalizeDebugEvents } from "./data.js";

const DEBUG_PORT_NAME = "debug-events-v1";
const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 1_000;

export function useDebug({ enabled, saved, runtime, sendMessage }) {
	const events = ref([]);
	const rows = computed(() => createDebugRows(events.value));
	const connection = reactive({ text: "调试已关闭", state: "off" });
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

	function replaceEvents(value) {
		events.value = normalizeDebugEvents(value);
	}

	function appendEvent(event) {
		if (!isRecord(event)) {
			return;
		}
		events.value = normalizeDebugEvents([...events.value, event]);
	}

	function handlePortMessage(message) {
		if (!isRecord(message)) {
			return;
		}
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
			nextPort.onMessage.addListener(handlePortMessage);
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
			const response = await sendMessage({ type: "GET_DEBUG_LOGS" });
			replaceEvents(response.events);
		} catch (error) {
			setConnection(errorText(error), "error");
		}
	}

	async function clear() {
		try {
			await sendMessage({ type: "CLEAR_DEBUG_LOGS" });
			replaceEvents([]);
			if (!enabled.value) {
				setConnection("事件已清空", "off");
				return true;
			}
			if (saved.value) {
				setConnection("事件已清空，实时调试已连接", "connected");
				return true;
			}
			setConnection("事件已清空；保存设置后开始记录", "connected");
			return true;
		} catch (error) {
			setConnection(errorText(error), "error");
			return false;
		}
	}

	function updateEnabled() {
		if (!enabled.value) {
			disconnect();
			if (saved.value) {
				setConnection("已断开；保存设置后停止记录", "off");
				return;
			}
			setConnection("调试已关闭", "off");
			return;
		}
		const connected = connect();
		if (connected && !saved.value) {
			setConnection("已连接；保存设置后开始记录", "connected");
		}
		void sync();
	}

	function updateSaved() {
		if (!enabled.value) {
			if (saved.value) {
				setConnection("已断开；保存设置后停止记录", "off");
				return;
			}
			setConnection("调试已关闭", "off");
			return;
		}
		if (saved.value) {
			if (!port && !connect()) {
				return;
			}
			setConnection("实时调试已连接", "connected");
			return;
		}
		setConnection("已连接；保存设置后开始记录", "connected");
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

	return { enabled, events, rows, connection, clear, sync };
}

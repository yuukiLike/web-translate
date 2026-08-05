import { ref } from "vue";

import { errorText } from "./formatters.js";

export function useDebugSettings({ busy, draft, sendMessage, setStatus }) {
	const savedLogging = ref(false);
	const savedRequestPayload = ref(false);

	function accept(settings) {
		savedLogging.value = settings.debugLogging === true;
		savedRequestPayload.value = settings.debugRequestPayload === true;
		draft.debugLogging = savedLogging.value;
		draft.debugRequestPayload = savedRequestPayload.value;
	}

	function sync(settings) {
		if (
			settings.debugLogging === savedLogging.value &&
			settings.debugRequestPayload === savedRequestPayload.value &&
			draft.debugLogging === savedLogging.value &&
			draft.debugRequestPayload === savedRequestPayload.value
		) {
			return;
		}
		accept(settings);
	}

	async function saveLogging() {
		const requested = draft.debugLogging;
		busy.value = "debug";
		setStatus(requested ? "正在开启调试记录…" : "正在关闭并清除正文记录…");
		try {
			const response = await sendMessage({ type: "SET_DEBUG_LOGGING", enabled: requested });
			accept(response);
			setStatus(response.debugLogging ? "调试记录已开启（不含网页正文）" : "调试记录已关闭");
			return true;
		} catch (error) {
			restore();
			setStatus(errorText(error), true);
			return false;
		} finally {
			busy.value = "";
		}
	}

	async function saveRequestPayload() {
		const requested = draft.debugRequestPayload;
		busy.value = "debug-payload";
		setStatus(requested ? "正在开启 DeepSeek 正文记录…" : "正在关闭并清除正文记录…");
		try {
			const response = await sendMessage({
				type: "SET_DEBUG_REQUEST_PAYLOAD",
				enabled: requested,
			});
			accept(response);
			setStatus(
				response.debugRequestPayload
					? "DeepSeek 正文记录已开启；无痕窗口仍不会记录"
					: "DeepSeek 正文记录已关闭并清除",
			);
			return true;
		} catch (error) {
			restore();
			setStatus(errorText(error), true);
			return false;
		} finally {
			busy.value = "";
		}
	}

	function restore() {
		draft.debugLogging = savedLogging.value;
		draft.debugRequestPayload = savedRequestPayload.value;
	}

	return { accept, savedLogging, saveLogging, saveRequestPayload, sync };
}

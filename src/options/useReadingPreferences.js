import { onBeforeUnmount, onMounted, ref } from "vue";
import { errorText } from "./formatters.js";
import { saveReadingPreferences } from "./readingSetup.js";

export function useReadingPreferences({ busy, draft, permissions, runtime, sendMessage, setStatus }) {
	let previewId = null;
	let exiting = false;
	const previewActive = ref(false);
	let savedReading = JSON.stringify(draft.reading);
	let savedSpeech = JSON.stringify(draft.speech);

	function accept(settings) {
		savedReading = JSON.stringify(settings.reading);
		savedSpeech = JSON.stringify(settings.speech);
	}

	function sync(settings) {
		if (JSON.stringify(draft.reading) === savedReading) draft.reading = settings.reading;
		if (JSON.stringify(draft.speech) === savedSpeech) draft.speech = settings.speech;
		accept(settings);
	}

	async function save() {
		if (busy.value) return false;
		busy.value = "reading";
		try {
			if (previewId) await stopPreview();
			const settings = await saveReadingPreferences({ permissions, sendMessage }, draft);
			draft.reading = settings.reading;
			draft.speech = settings.speech;
			accept(settings);
			setStatus("阅读偏好已保存，已开启的页面会立即更新译文样式");
			return true;
		} catch (error) {
			setStatus(errorText(error), true);
			return false;
		} finally {
			busy.value = "";
		}
	}

	async function previewSpeech() {
		if (previewId) {
			await stopPreview();
			return;
		}
		if (!await save() || exiting) return;
		busy.value = "speech";
		previewId = crypto.randomUUID();
		previewActive.value = true;
		const requestId = previewId;
		try {
			const response = await sendMessage({ type: "SPEAK_TEXT", requestId, text: "Good ideas deserve to be understood. Keep reading, one paragraph at a time." });
			if (previewId !== requestId) return;
			if (response.cancelled) finishPreview("英语试听已停止");
			else setStatus("正在播放英语发音");
		} catch (error) {
			if (previewId === requestId) finishPreview(errorText(error), true);
		} finally {
			if (busy.value === "speech" && (!previewId || previewId === requestId)) busy.value = "";
		}
	}

	async function stopPreview() {
		const requestId = previewId;
		if (!requestId) return;
		finishPreview("英语试听已停止");
		try {
			await sendMessage({ type: "STOP_SPEECH", requestId });
		} catch (error) {
			if (!previewId) setStatus(errorText(error), true);
		}
	}

	function finishPreview(text, error = false) {
		previewId = null;
		previewActive.value = false;
		if (busy.value === "speech") busy.value = "";
		setStatus(text, error);
	}

	function onSpeechEvent(message, sender) {
		if (sender.id !== runtime?.id || message?.target !== "speech-ui" || message.requestId !== previewId) return;
		if (!["end", "cancelled", "interrupted", "error"].includes(message.state)) return;
		finishPreview(message.error || "英语试听已结束", message.state === "error");
	}

	function stopOnExit() {
		exiting = true;
		if (previewId) void sendMessage({ type: "STOP_SPEECH", requestId: previewId }).catch(() => {});
		previewId = null;
		previewActive.value = false;
		if (busy.value === "speech") busy.value = "";
	}
	function resumePage() { exiting = false; }

	onMounted(() => {
		runtime?.onMessage?.addListener(onSpeechEvent);
		window.addEventListener("pagehide", stopOnExit);
		window.addEventListener("pageshow", resumePage);
	});

	async function grantFrames() {
		if (busy.value) return;
		busy.value = "permission";
		try {
			if (!await permissions.request({ origins: ["https://*/*"] })) throw new Error("未授予嵌入内容的访问权限");
			await sendMessage({ type: "REFRESH_READING_FRAMES" });
			setStatus("已授权 HTTPS 嵌入内容，正在阅读的页面会补充处理可访问的框架");
		} catch (error) {
			setStatus(errorText(error), true);
		} finally {
			busy.value = "";
		}
	}

	onBeforeUnmount(() => {
		runtime?.onMessage?.removeListener(onSpeechEvent);
		window.removeEventListener("pagehide", stopOnExit);
		window.removeEventListener("pageshow", resumePage);
		stopOnExit();
	});

	return { save, previewSpeech, previewActive, grantFrames, accept, sync };
}

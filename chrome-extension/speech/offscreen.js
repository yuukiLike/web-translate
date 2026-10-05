let playback = null;
const MAX_AUDIO_BYTES = 8_000_000;

function release(current) {
	current.controller.abort();
	if (current.audio) {
		current.audio.pause();
		current.audio.removeAttribute("src");
		current.audio.load();
	}
	if (current.url) URL.revokeObjectURL(current.url);
	if (playback === current) playback = null;
}

async function finish(current, state, error = "") {
	if (playback !== current) return;
	release(current);
	await chrome.runtime.sendMessage({ type: "SPEECH_EVENT", requestId: current.requestId, state, error }).catch(() => {});
}

async function readAudio(response, signal) {
	if (response.status === 401) throw new Error("Edge TTS 令牌已失效，请在阅读设置中更新令牌");
	if (response.status === 429) throw new Error("Edge TTS 正在处理上一段语音，请稍后重试");
	if (response.status === 504) throw new Error("Edge TTS 合成超时，请缩短文字或检查网络");
	if (!response.ok) throw new Error(`Edge TTS 服务返回 HTTP ${response.status}`);
	if (!/^audio\/(?:mpeg|mp3)(?:;|$)/iu.test(response.headers.get("content-type") ?? "")) {
		throw new Error("Edge TTS 服务应返回 MP3 音频");
	}
	if (!response.body) throw new Error("Edge TTS 返回了空音频");
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_AUDIO_BYTES) throw new Error("语音文件过大，请缩短选中的文字");
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	if (!bytes) throw new Error("Edge TTS 返回了空音频");
	return new Blob(chunks, { type: "audio/mpeg" });
}

async function play(message) {
	if (playback) release(playback);
	const current = { requestId: message.requestId, controller: new AbortController(), audio: null, url: null };
	playback = current;
	try {
		const signal = AbortSignal.any([current.controller.signal, AbortSignal.timeout(25_000)]);
		const response = await fetch(message.settings.endpoint, {
			method: "POST", credentials: "omit", cache: "no-store", redirect: "error", signal,
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${message.settings.token}` },
			body: JSON.stringify({ text: message.text, voice: message.settings.voice, rate: message.settings.rate }),
		});
		const blob = await readAudio(response, signal);
		if (playback !== current) return { ok: true, cancelled: true };
		current.url = URL.createObjectURL(blob);
		current.audio = new Audio(current.url);
		current.audio.addEventListener("ended", () => void finish(current, "end"), { once: true });
		current.audio.addEventListener("error", () => void finish(current, "error", "Edge TTS 音频无法解码"), { once: true });
		await current.audio.play();
		return { ok: true };
	} catch (error) {
		const reason = current.controller.signal.aborted ? "朗读已停止" : error.name === "TimeoutError"
			? "Edge TTS 响应超时，请检查本地服务"
			: error.message === "Failed to fetch" ? "无法连接 Edge TTS，请启动本地语音服务" : error.message;
		await finish(current, "error", reason);
		return { ok: false, error: reason };
	}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.target !== "speech-offscreen") return false;
	if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && !sender.url.startsWith(chrome.runtime.getURL("")))) {
		sendResponse({ ok: false, error: "无效的语音请求来源" });
		return false;
	}
	if (message.type === "STOP") {
		if (playback?.requestId === message.requestId) release(playback);
		sendResponse({ ok: true });
		return false;
	}
	if (message.type !== "PLAY") return false;
	void play(message).then(sendResponse);
	return true;
});

window.addEventListener("pagehide", () => {
	if (playback) release(playback);
});

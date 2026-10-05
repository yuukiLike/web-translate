import { createSerialTaskQueue } from "./utilities.js";

const OFFSCREEN_PATH = "speech/offscreen.html";
const SESSION_KEY = "reading-speech";
const END_EVENTS = new Set(["end", "cancelled", "interrupted", "error"]);

/** 密钥和 Edge 服务地址只经过扩展的可信上下文，页面只提交文字。 */
export function createSpeechService({ chrome, settingsStore, validators }) {
	const queue = createSerialTaskQueue();
	let creating = null;

	async function active() {
		return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
	}

	function getOwner(sender) {
		if (settingsStore.isExtensionPageUrl(sender.url)) return { tabId: null, frameId: null, documentId: sender.documentId ?? null };
		if (Number.isInteger(sender.tab?.id)) return { tabId: sender.tab.id, frameId: sender.frameId ?? 0,
			documentId: sender.documentId ?? null };
		settingsStore.assertExtensionPage(sender);
		return { tabId: null, frameId: null };
	}

	async function offscreenExists() {
		const contexts = await chrome.runtime.getContexts({
			contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
		});
		return contexts.length > 0;
	}

	async function ensureOffscreen() {
		if (await offscreenExists()) return;
		creating ??= chrome.offscreen.createDocument({
			url: OFFSCREEN_PATH, reasons: ["AUDIO_PLAYBACK"], justification: "播放用户主动选择的英语发音",
		}).finally(() => { creating = null; });
		await creating;
	}

	async function notify(playback, type, error = "") {
		if (!playback) return;
		if (!Number.isInteger(playback.tabId)) {
			await chrome.runtime.sendMessage({ target: "speech-ui", type: "BT_SPEECH_EVENT",
				requestId: playback.requestId, state: type, error }).catch(() => {});
			return;
		}
		await chrome.tabs.sendMessage(playback.tabId, {
			type: "BT_SPEECH_EVENT", requestId: playback.requestId, state: type, engine: playback.engine, error,
		}, playback.documentId
			? { documentId: playback.documentId } : { frameId: playback.frameId }).catch(() => {});
	}

	async function stopPlayback(playback) {
		if (!playback) return;
		if (playback.engine === "edge" && await offscreenExists()) {
			await chrome.runtime.sendMessage({ target: "speech-offscreen", type: "STOP", requestId: playback.requestId }).catch(() => {});
		} else if (playback.engine === "system") chrome.tts.stop();
		await chrome.storage.session.remove(SESSION_KEY);
		await notify(playback, "cancelled");
	}

	async function assertEdgePermission(settings) {
		if (!settings.endpoint) throw new Error("请在设置中填写有效的 Edge TTS 服务地址");
		if (!settings.token) throw new Error("请在设置中填写 Edge TTS 服务的访问令牌");
		const origin = new URL(settings.endpoint).origin;
		if (!await chrome.permissions.contains({ origins: [`${origin}/*`] })) {
			throw new Error("请在设置中保存阅读偏好，并授权访问 Edge TTS 服务");
		}
	}

	async function speak(message, sender) {
		const owner = getOwner(sender);
		const requestId = validators.validateRunId(message.requestId);
		if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 6_000) {
			throw new Error("每次朗读请选择 1 到 6,000 个字符");
		}
		if (!/[A-Za-z]/u.test(message.text)) throw new Error("请选择英语文字进行朗读");
		const { playback, speech } = await queue.run(async () => {
			const speech = (await settingsStore.getSettings()).speech;
			if (speech.engine === "edge") await assertEdgePermission(speech);
			const playback = { ...owner, requestId, engine: speech.engine };
			await stopPlayback(await active());
			await chrome.storage.session.set({ [SESSION_KEY]: playback });
			return { playback, speech };
		});
		try {
			if (speech.engine === "edge") {
				await ensureOffscreen();
				const prepared = await queue.run(async () => {
					if ((await active())?.requestId !== requestId) return null;
					// 只串行投递，不在队列内等音频，停止操作可以取消正在合成的请求。
					return { started: chrome.runtime.sendMessage({
						target: "speech-offscreen", type: "PLAY", requestId, text: message.text, settings: speech,
					}) };
				});
				if (!prepared) return { cancelled: true };
				const response = await prepared.started;
				if (!response?.ok) throw new Error(response?.error || "Edge TTS 无法播放，请检查本地服务");
			} else {
				const voices = await chrome.tts.getVoices();
				const locale = speech.voice.slice(0, 5).toLowerCase();
				const english = voices.filter((voice) => /^en(?:-|$)/iu.test(voice.lang ?? ""));
				english.sort((a, b) => scoreVoice(b, locale) - scoreVoice(a, locale));
				if (!english.length) throw new Error("系统没有可用的英语语音，请在设置中选择 Edge TTS");
				const started = await queue.run(async () => {
					if ((await active())?.requestId !== requestId) return false;
					await chrome.tts.speak(message.text, {
						voiceName: english[0].voiceName, lang: english[0].lang, rate: speech.rate, enqueue: false,
						onEvent: (event) => void handleEvent(playback, event.type, event.type === "error" ? "系统语音播放失败" : "").catch(() => {}),
					});
					return true;
				});
				if (!started) return { cancelled: true };
			}
			return { requestId, engine: speech.engine };
		} catch (error) {
			await handleEvent(playback, "error", error.message);
			throw error;
		}
	}

	function stop(message, sender) {
		const owner = getOwner(sender);
		validators.validateRunId(message.requestId);
		return queue.run(async () => {
			const playback = await active();
			if (playback?.requestId === message.requestId && playback.tabId === owner.tabId &&
				playback.frameId === owner.frameId && (playback.documentId ?? null) === owner.documentId) {
				await stopPlayback(playback);
			}
			return {};
		});
	}

	function handleEvent(playback, type, error = "") {
		return queue.run(async () => {
			if ((await active())?.requestId !== playback.requestId) return {};
			if (END_EVENTS.has(type)) await chrome.storage.session.remove(SESSION_KEY);
			await notify(playback, type, error);
			return {};
		});
	}

	async function offscreenEvent(message, sender) {
		if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PATH)) throw new Error("无效的语音事件来源");
		const playback = await active();
		if (playback?.requestId !== message.requestId) return {};
		return handleEvent(playback, message.state, message.error);
	}

	function removeTab(tabId, frameId = null) {
		return queue.run(async () => {
			const playback = await active();
			if (playback?.tabId === tabId && (frameId === null || playback.frameId === frameId)) await stopPlayback(playback);
		});
	}

	return { speak, stop, offscreenEvent, removeTab };
}

function scoreVoice(voice, locale) {
	return (voice.lang?.toLowerCase() === locale ? 4 : 0) + (voice.remote ? 0 : 2) + (voice.eventTypes?.includes("end") ? 1 : 0);
}

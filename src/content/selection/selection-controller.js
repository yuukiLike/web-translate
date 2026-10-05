import { captureSelection, selectionConnected } from "./selection-snapshot.js";
import { SelectionTracker } from "./selection-tracker.js";
import { SelectionView } from "./selection-view.js";

const MAX_TRANSLATION_LENGTH = 12_000;
const MAX_SPEECH_LENGTH = 6_000;

/** 每次选择拥有自己的请求和结果；关闭后旧回调不能再改写新浮层。 */
export class SelectionController {
	#session = null;
	active = false;

	constructor({ core, runtime }) {
		Object.assign(this, { core, runtime });
		this.view = new SelectionView({
			translate: (event) => void this.translate(event.detail === 0),
			speak: (event) => void this.speak(event.detail === 0),
			copy: () => void this.copy(),
			close: () => this.close(),
			lost: () => this.close({ restoreFocus: false }),
			settings: () => void this.openSettings(),
		});
		this.tracker = new SelectionTracker({
			core, view: this.view,
			onSelection: (snapshot) => this.#preview(snapshot),
			onOutside: () => this.close({ restoreFocus: false }),
			onEscape: () => this.close(),
		});
	}

	enable() {
		if (this.active) return;
		this.active = true;
		this.tracker.enable();
	}

	disable() {
		this.active = false;
		this.tracker.disable();
		this.close({ restoreFocus: false });
	}

	getSelection() {
		const snapshot = this.view.focused ? this.#session?.snapshot : captureSelection(this.core);
		return snapshot && selectionConnected(snapshot) ? { text: snapshot.text, focused: document.hasFocus() } : null;
	}

	open(text = "", speakOnly = false) {
		if (typeof text !== "string") throw new Error("选中文字格式无效");
		const normalized = this.core.normalizeSourceText(text);
		const current = captureSelection(this.core);
		const saved = this.#session?.snapshot;
		let snapshot = current;
		if (normalized && current?.text !== normalized) {
			snapshot = this.view.focused && saved?.text === normalized && selectionConnected(saved)
				? saved : { text: normalized };
		}
		if (!snapshot?.text || !/\p{L}/u.test(snapshot.text)) throw new Error("请先选择需要翻译的文字");
		this.enable();
		if (snapshot === saved && this.view.panelOpen) {
			if (speakOnly) void this.speak();
			else void this.translate();
			return;
		}
		this.close({ restoreFocus: false });
		this.#session = this.#createSession(snapshot);
		this.#showPanel(true);
		if (speakOnly) void this.speak();
		else void this.translate();
	}

	async translate(focus = false) {
		const session = this.#session;
		if (!session || session.requestId) return;
		if (!this.view.panelOpen) this.#showPanel(focus);
		this.#stopSpeech(session);
		session.response = null;
		this.#updateSpeechAvailability(session);
		if (session.snapshot.text.length > MAX_TRANSLATION_LENGTH) {
			this.view.showError("选中文字超过 12,000 个字符，请缩小选择范围");
			return;
		}
		const requestId = crypto.randomUUID();
		session.requestId = requestId;
		this.view.loading();
		try {
			const response = await this.runtime.send({ type: "TRANSLATE_SELECTION", requestId, text: session.snapshot.text });
			if (this.#session !== session || session.requestId !== requestId) return;
			session.response = response;
			this.view.showResult(response);
			this.#updateSpeechAvailability(session);
		} catch (error) {
			if (this.#session === session && session.requestId === requestId) this.view.showError(error.message);
		} finally {
			if (session.requestId === requestId) session.requestId = null;
		}
	}

	async speak(focus = false) {
		const session = this.#session;
		if (!session) return;
		if (!this.view.panelOpen) this.#showPanel(focus);
		if (session.speechId) {
			this.#stopSpeech(session);
			this.view.setNotice("朗读已停止");
			return;
		}
		const text = this.#englishText(session);
		if (!text || text.length > MAX_SPEECH_LENGTH) {
			this.view.setNotice(text ? "朗读最多支持 6,000 个字符，请缩小选择范围" : "英语译文完成后即可朗读", true);
			return;
		}
		const requestId = crypto.randomUUID();
		session.speechId = requestId;
		this.view.showSpeech("loading");
		try {
			const response = await this.runtime.send({ type: "SPEAK_TEXT", requestId, text });
			if (this.#session !== session || session.speechId !== requestId) return;
			if (response.cancelled) {
				this.#stopSpeech(session);
				this.view.setNotice("朗读已取消");
			} else this.view.showSpeech("playing", response.engine);
		} catch (error) {
			if (this.#session !== session || session.speechId !== requestId) return;
			session.speechId = null;
			this.view.showSpeech("idle");
			this.view.setNotice(error.message, true);
		}
	}

	onSpeechEvent(message) {
		const session = this.#session;
		if (!session || session.speechId !== message.requestId) return;
		if (message.state === "start") this.view.showSpeech("playing", message.engine);
		if (["end", "cancelled", "interrupted", "error"].includes(message.state)) {
			session.speechId = null;
			this.view.showSpeech("idle");
			this.view.setNotice(message.error || (message.state === "end" ? "朗读已结束" : "朗读已停止"), message.state === "error");
		}
	}

	async copy() {
		const session = this.#session;
		const text = session?.response?.text;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			if (this.#session === session) this.view.setNotice("译文已复制");
		} catch {
			if (this.#session !== session) return;
			this.view.selectTranslation();
			this.view.setNotice("浏览器限制直接复制，请按 Ctrl/Cmd+C 复制已选中的译文");
		}
	}

	async openSettings() {
		const session = this.#session;
		try { await this.runtime.openOptions(); }
		catch (error) {
			if (this.#session === session) this.view.setNotice(error.message, true);
		}
	}

	close(options = {}) {
		const session = this.#session;
		this.#session = null;
		this.tracker.dismiss();
		if (session?.requestId) void this.runtime.send({ type: "CANCEL_SELECTION", requestId: session.requestId }).catch(() => {});
		this.#stopSpeech(session);
		this.view.remove(options);
	}

	#preview(snapshot) {
		if (this.view.panelOpen) return;
		if (!snapshot) { this.close({ restoreFocus: false }); return; }
		this.#session = this.#createSession(snapshot);
		const english = this.#englishText(this.#session);
		this.view.showLauncher(snapshot, Boolean(english && english.length <= MAX_SPEECH_LENGTH));
	}

	#createSession(snapshot) {
		return { snapshot, sourceLanguage: this.core.getLanguagePair("", snapshot.text).sourceLanguage,
			response: null, requestId: null, speechId: null };
	}

	#showPanel(focus) {
		const session = this.#session;
		this.tracker.dismiss();
		this.view.showPanel(session.snapshot, session.sourceLanguage, { focus });
		this.#updateSpeechAvailability(session);
	}

	#englishText(session) {
		return (session.response?.sourceLanguage ?? session.sourceLanguage) === "en" ? session.snapshot.text : session.response?.text;
	}

	#updateSpeechAvailability(session) {
		const text = this.#englishText(session);
		this.view.setSpeechAvailable(Boolean(text && text.length <= MAX_SPEECH_LENGTH),
			text ? "朗读最多支持 6,000 个字符" : "翻译完成后可朗读英语译文");
	}

	#stopSpeech(session) {
		if (session?.speechId) {
			void this.runtime.send({ type: "STOP_SPEECH", requestId: session.speechId }).catch(() => {});
			session.speechId = null;
		}
		this.view.showSpeech("idle");
	}
}

import { isRecord, safeString } from "./value-utils.js";

export const TRANSLATION_STYLES = Object.freeze(["soft", "plain", "underline"]);
export const ENGLISH_VOICES = Object.freeze([
	{ id: "en-US-AriaNeural", label: "Aria · 美式女声" },
	{ id: "en-US-GuyNeural", label: "Guy · 美式男声" },
	{ id: "en-GB-SoniaNeural", label: "Sonia · 英式女声" },
	{ id: "en-GB-RyanNeural", label: "Ryan · 英式男声" },
]);

export function createDefaultReadingSettings() {
	return { style: "soft", fontScale: 1, lineHeight: 1.65, selectionEnabled: true };
}

export function normalizeReadingSettings(value) {
	const input = isRecord(value) ? value : {};
	return {
		style: TRANSLATION_STYLES.includes(input.style) ? input.style : "soft",
		fontScale: boundedNumber(input.fontScale, 1, 0.8, 1.3),
		lineHeight: boundedNumber(input.lineHeight, 1.65, 1.4, 2.2),
		selectionEnabled: input.selectionEnabled !== false,
	};
}

export function createDefaultSpeechSettings() {
	return {
		engine: "system",
		voice: "en-US-AriaNeural",
		rate: 1,
		endpoint: "http://127.0.0.1:8765/tts",
		token: "",
	};
}

export function normalizeSpeechEndpoint(value) {
	try {
		const url = new URL(safeString(value, "", 2_048));
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (url.username || url.password || url.search || url.hash) return "";
		if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
		return url.href;
	} catch {
		return "";
	}
}

export function normalizeSpeechSettings(value) {
	const input = isRecord(value) ? value : {};
	const defaults = createDefaultSpeechSettings();
	const engine = input.engine === "edge" ? "edge" : "system";
	const requestedVoice = ENGLISH_VOICES.some((voice) => voice.id === input.voice) ? input.voice : defaults.voice;
	return {
		engine,
		voice: engine === "edge" ? requestedVoice : requestedVoice.startsWith("en-GB") ? "en-GB-SoniaNeural" : "en-US-AriaNeural",
		rate: boundedNumber(input.rate, 1, 0.5, 2),
		endpoint: normalizeSpeechEndpoint(input.endpoint ?? defaults.endpoint),
		token: safeString(input.token, "", 512),
	};
}

function boundedNumber(value, fallback, minimum, maximum) {
	const number = typeof value === "number" ? value : Number.parseFloat(value);
	return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

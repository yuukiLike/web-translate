import { normalizeReadingSettings, normalizeSpeechSettings } from "../core/reading-settings.js";

export async function saveReadingPreferences({ permissions, sendMessage }, draft) {
	const reading = normalizeReadingSettings(draft.reading);
	const speech = normalizeSpeechSettings(draft.speech);
	if (speech.engine === "edge") {
		if (!speech.endpoint) throw new Error("请填写有效的 Edge TTS 地址（HTTPS 或本机 HTTP）");
		if (!speech.token) throw new Error("请填写 Edge TTS 本地服务启动时显示的访问令牌");
		const origins = [`${new URL(speech.endpoint).origin}/*`];
		if (!await permissions.contains({ origins }) && !await permissions.request({ origins })) {
			throw new Error("未授权访问 Edge TTS 服务，阅读偏好尚未保存");
		}
	}
	const response = await sendMessage({ type: "SET_READING_PREFERENCES", reading, speech });
	return response.settings;
}

import assert from "node:assert/strict";
import test from "node:test";
import { createSpeechService } from "../../chrome-extension/background/speech-service.js";
import { createMessageValidators } from "../../chrome-extension/background/validation.js";
import { backgroundCore, createChromeHarness, createConfiguredSettings, createWebpageSender } from "../helpers/background-harness.mjs";

function createSpeech(voices) {
	const harness = createChromeHarness();
	const spoken = [];
	harness.chrome.tts = {
		stop() {}, getVoices: async () => voices,
		speak: async (text, options) => { spoken.push({ text, voice: options.voiceName }); },
	};
	const speech = createSpeechService({ chrome: harness.chrome, validators: createMessageValidators(backgroundCore),
		settingsStore: { isExtensionPageUrl: () => false, getSettings: async () => createConfiguredSettings() },
		assertPageAccess: async () => {},
	});
	return { speech, spoken };
}

// 用户选择系统语音时，匹配口音的联网声音不能排在本机声音之前。
test("系统朗读只选择明确的本机声音", async () => {
	const { speech, spoken } = createSpeech([
		{ voiceName: "Local English", lang: "en-GB", remote: false },
		{ voiceName: "Remote English", lang: "en-US", remote: true },
		{ voiceName: "Unknown English", lang: "en-US" },
		{ voiceName: "Extension English", lang: "en-US", remote: false, extensionId: "another-extension" },
		{ voiceName: "Shared English", lang: "en-US", remote: false },
		{ voiceName: "Shared English", lang: "en-US", remote: true },
		{ lang: "en-US", remote: false },
	]);
	const sender = createWebpageSender();
	await speech.speak({ requestId: "speech-test", text: "Synthetic confidential sentence." }, sender);
	assert.equal(spoken.length, 1);
	assert.equal(spoken[0].voice, "Local English");
	await speech.stop({ requestId: "speech-test" }, sender);
});

// 没有本机声音时明确报错，不能自动改用联网、来源不明或其他扩展提供的引擎。
test("系统朗读没有本机声音时不发送文本", async () => {
	const { speech, spoken } = createSpeech([
		{ voiceName: "Remote English", lang: "en-US", remote: true },
		{ voiceName: "Unknown English", lang: "en-US" },
		{ lang: "en-US", remote: false },
		{ voiceName: "", lang: "en-US", remote: false },
	]);
	await assert.rejects(speech.speak({ requestId: "speech-none", text: "Synthetic confidential sentence." }, createWebpageSender()), /本机/u);
	assert.equal(spoken.length, 0);
});

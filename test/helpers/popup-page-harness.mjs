import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Window } from "happy-dom";
import { exposeGlobals, settle, waitFor } from "./page-harness.mjs";

export { settle, waitFor };

const extensionUrl = new URL("../../chrome-extension/", import.meta.url);
const popupScriptUrl = new URL("popup/popup.js", extensionUrl);
let importSequence = 0;

function extractBody(html) {
	const body = /<body>([\s\S]*?)<\/body>/u.exec(html)?.[1];
	assert.ok(body, "Popup HTML 缺少 body");
	return body.replace(/\s*<script\s+src="popup\.js"><\/script>\s*/u, "");
}

export function createPopupState(overrides = {}) {
	return {
		ok: true,
		popupProtocolVersion: 2,
		version: "0.4.0",
		providerLabel: "DeepSeek",
		model: "deepseek-v4-flash",
		languagePair: { sourceMode: "auto", targetLanguage: "zh" },
		debugLogging: false,
		configured: true,
		canTranslate: true,
		unavailableReason: "",
		...overrides,
	};
}

export async function createPopupPageHarness(options = {}) {
	const window = new Window({ url: "chrome-extension://popup-test/popup/index.html" });
	const html = await readFile(new URL("popup/index.html", extensionUrl), "utf8");
	window.document.body.innerHTML = extractBody(html);
	const calls = [];
	const createdTabs = [];
	let closeCount = 0;
	let optionsOpenCount = 0;
	let reloadCount = 0;
	const popupState = createPopupState(options.popupState);
	const chromeApi = {
		runtime: {
			getURL(path = "") {
				return `chrome-extension://popup-test/${path}`;
			},
			reload() {
				reloadCount += 1;
				if (options.reloadError) throw options.reloadError;
			},
			async openOptionsPage() {
				optionsOpenCount += 1;
				if (options.optionsError) throw options.optionsError;
			},
			async sendMessage(message) {
				calls.push(structuredClone(message));
				if (message.type === "GET_POPUP_STATE") {
					return options.getPopupState ? await options.getPopupState() : structuredClone(popupState);
				}
				if (message.type === "SET_LANGUAGE_PAIR") {
					if (options.setLanguagePair) return options.setLanguagePair(message);
					popupState.languagePair = {
						sourceMode: message.sourceMode,
						targetLanguage: message.targetLanguage,
					};
					return {
						ok: true,
						popupProtocolVersion: 2,
						languagePair: structuredClone(popupState.languagePair),
					};
				}
				if (message.type === "TOGGLE_ACTIVE_TAB") {
					return options.toggleActiveTab
						? await options.toggleActiveTab()
						: { ok: true, status: "triggered" };
				}
				return { ok: false, error: `未处理消息：${message.type}` };
			},
		},
		tabs: {
			async create(details) {
				if (options.debugError) throw options.debugError;
				createdTabs.push(structuredClone(details));
				return { id: createdTabs.length, ...structuredClone(details) };
			},
		},
	};
	const restoreGlobals = exposeGlobals({
		chrome: chromeApi,
		close: () => {
			closeCount += 1;
		},
		document: window.document,
		window,
	});
	importSequence += 1;
	await import(`${popupScriptUrl.href}?popup-page=${importSequence}`);
	await waitFor(
		() => calls.some((message) => message.type === "GET_POPUP_STATE"),
		"Popup 未请求初始状态",
	);
	await settle();

	return {
		calls,
		createdTabs,
		document: window.document,
		window,
		get closeCount() {
			return closeCount;
		},
		get optionsOpenCount() {
			return optionsOpenCount;
		},
		get reloadCount() {
			return reloadCount;
		},
		cleanup() {
			restoreGlobals();
			window.close();
		},
	};
}

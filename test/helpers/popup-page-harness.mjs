import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Window } from "happy-dom";

const extensionUrl = new URL("../../chrome-extension/", import.meta.url);
const popupScriptUrl = new URL("popup/popup.js", extensionUrl);
let importSequence = 0;

function exposeGlobals(values) {
	const previous = new Map();
	for (const [name, value] of Object.entries(values)) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	}
	return () => {
		for (const [name, descriptor] of previous) {
			if (descriptor) {
				Object.defineProperty(globalThis, name, descriptor);
			} else {
				delete globalThis[name];
			}
		}
	};
}

function extractBody(html) {
	const body = /<body>([\s\S]*?)<\/body>/u.exec(html)?.[1];
	assert.ok(body, "Popup HTML 缺少 body");
	return body.replace(/\s*<script\s+src="popup\.js"><\/script>\s*/u, "");
}

export function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

export async function settle() {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await Promise.resolve();
}

export async function waitFor(predicate, message) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (predicate()) return;
		await settle();
	}
	assert.fail(message);
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
	const popupState = {
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
		...options.popupState,
	};
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

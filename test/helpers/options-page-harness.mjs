import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { exposeGlobals, settle, waitFor } from "./page-harness.mjs";

const catalogUrl = new URL("../../chrome-extension/generated/provider-catalog.js", import.meta.url);
const coreUrl = new URL("../../chrome-extension/generated/core.js", import.meta.url);
const optionsUrl = new URL("../../chrome-extension/options/options.js", import.meta.url);
let optionsImportId = 0;
export { settle, waitFor };
function createEventHub() {
	const listeners = new Set();
	return {
		addListener(listener) {
			listeners.add(listener);
		},
		removeListener(listener) {
			listeners.delete(listener);
		},
		emit(...arguments_) {
			for (const listener of listeners) {
				listener(...arguments_);
			}
		},
	};
}
function createPort() {
	const onMessage = createEventHub();
	const onDisconnect = createEventHub();
	return {
		disconnected: false,
		messages: [],
		onDisconnect,
		onMessage,
		disconnect() {
			if (this.disconnected) {
				return;
			}
			this.disconnected = true;
			onDisconnect.emit();
		},
		drop() {
			this.disconnected = true;
			onDisconnect.emit();
		},
		postMessage(message) {
			this.messages.push(structuredClone(message));
		},
	};
}
function exposeWindow(window) {
	return exposeGlobals({
		CustomEvent: window.CustomEvent,
		Document: window.Document,
		Element: window.Element,
		Event: window.Event,
		HTMLElement: window.HTMLElement,
		HTMLInputElement: window.HTMLInputElement,
		HTMLSelectElement: window.HTMLSelectElement,
		MutationObserver: window.MutationObserver,
		Node: window.Node,
		SVGElement: window.SVGElement,
		document: window.document,
		getComputedStyle: window.getComputedStyle.bind(window),
		location: window.location,
		navigator: window.navigator,
		window,
	});
}
function installControlledTimers() {
	const nativeTimers = {
		clearInterval: globalThis.clearInterval,
		clearTimeout: globalThis.clearTimeout,
		setInterval: globalThis.setInterval,
		setTimeout: globalThis.setTimeout,
	};
	let heartbeat;
	let heartbeatDelay;
	let reconnect;
	globalThis.setInterval = (callback, delay) => {
		heartbeat = callback;
		heartbeatDelay = delay;
		return 101;
	};
	globalThis.clearInterval = () => {
		heartbeat = undefined;
	};
	globalThis.setTimeout = (callback, delay, ...arguments_) => {
		if (delay === 1_000) {
			reconnect = callback;
			return 102;
		}
		return nativeTimers.setTimeout(callback, delay, ...arguments_);
	};
	globalThis.clearTimeout = (timer) => {
		if (timer === 102) {
			reconnect = undefined;
			return;
		}
		nativeTimers.clearTimeout(timer);
	};
	return {
		get heartbeatDelay() {
			return heartbeatDelay;
		},
		runHeartbeat() {
			assert.equal(typeof heartbeat, "function", "调试心跳尚未启动");
			heartbeat();
		},
		runReconnect() {
			assert.equal(typeof reconnect, "function", "调试重连尚未排队");
			const callback = reconnect;
			reconnect = undefined;
			callback();
		},
		restore() {
			Object.assign(globalThis, nativeTimers);
		},
	};
}
export function clickByText(document, selector, text) {
	const element = [...document.querySelectorAll(selector)].find((candidate) =>
		candidate.textContent.includes(text),
	);
	assert.ok(element, `找不到包含“${text}”的 ${selector}`);
	element.click();
	return element;
}
export function inputValue(window, input, value) {
	input.value = value;
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
export async function chooseProvider(window, document, providerId) {
	const input = document.querySelector(`#provider-${providerId}`);
	assert.ok(input, `找不到 Provider：${providerId}`);
	input.checked = true;
	input.dispatchEvent(new window.Event("change", { bubbles: true }));
	await settle();
}
async function loadGeneratedGlobals() {
	await import(catalogUrl.href);
	await import(coreUrl.href);
	assert.ok(globalThis.BilingualTranslatorProviderCatalog, "模型目录未载入");
	assert.ok(globalThis.BilingualTranslatorCore, "核心运行时未载入");
}
export async function createOptionsPageHarness(options = {}) {
	await loadGeneratedGlobals();
	const core = globalThis.BilingualTranslatorCore;
	const window = new Window({ url: "chrome-extension://options-test/options/index.html" });
	let copiedText = "";
	Object.defineProperty(window.navigator, "clipboard", {
		configurable: true,
		value: { async writeText(value) { copiedText = value; } },
	});
	const restoreWindow = exposeWindow(window);
	const timers = installControlledTimers();
	const calls = [];
	const ports = [];
	const storageChanged = createEventHub();
	let debugEvents = [];
	let settings = core.normalizeSettings(options.settings ?? {
		provider: "deepseek",
		deepseek: { apiKey: "deepseek-key", model: "deepseek-v4-flash" },
	});
	const usage = {
		[core.getMonthKey()]: {
			deepseek: { apiCalls: 1, inputTokens: 4, outputTokens: 2 },
		},
	};
	const chromeApi = {
		runtime: {
			reload() {
				options.onReload?.();
			},
			connect() {
				const port = createPort();
				ports.push(port);
				return port;
			},
			getManifest: () => ({ version: "0.4.0" }),
			async sendMessage(message) {
				calls.push(structuredClone(message));
				switch (message.type) {
					case "GET_OPTIONS_STATE":
						if (options.getOptionsState) {
							return options.getOptionsState({ core, settings, storageChanged, usage });
						}
						return {
							ok: true,
							settings: structuredClone(settings),
							usage,
						};
					case "SET_LANGUAGE_PAIR":
						if (options.setLanguagePair) return options.setLanguagePair(message);
						settings = core.normalizeSettings({
							...settings,
							sourceMode: message.sourceMode,
							targetMode: message.targetLanguage,
						});
						return {
							ok: true,
							popupProtocolVersion: 2,
							languagePair: {
								sourceMode: settings.sourceMode,
								targetLanguage: settings.targetMode,
							},
						};
					case "SAVE_SETTINGS":
						settings = core.normalizeSettings({
							...message.settings,
							sourceMode: settings.sourceMode,
							targetMode: settings.targetMode,
						});
						return { ok: true, settings: structuredClone(settings) };
					case "SET_DEBUG_LOGGING":
						settings = core.normalizeSettings({ ...settings, debugLogging: message.enabled });
						return {
							ok: true,
							debugLogging: settings.debugLogging,
							debugRequestPayload: settings.debugRequestPayload,
						};
					case "SET_DEBUG_REQUEST_PAYLOAD":
						settings = core.normalizeSettings({
							...settings,
							debugRequestPayload: message.enabled,
						});
						return {
							ok: true,
							debugLogging: settings.debugLogging,
							debugRequestPayload: settings.debugRequestPayload,
						};
					case "TEST_PROVIDER":
						return { ok: true, message: "OpenAI 连接成功" };
					case "GET_DEBUG_LOGS":
						return { ok: true, events: structuredClone(debugEvents) };
					case "CLEAR_CACHE":
						return { ok: true, removed: 3 };
					case "CLEAR_DEBUG_LOGS":
						debugEvents = [];
						return { ok: true };
					default:
						return { ok: false, error: `未处理消息：${message.type}` };
				}
			},
		},
		storage: { onChanged: storageChanged },
	};
	const restoreChrome = exposeGlobals({ chrome: chromeApi });
	window.document.body.innerHTML = '<div id="app"></div>';
	optionsImportId += 1;
	await import(`${optionsUrl.href}?options-page=${optionsImportId}`);
	await waitFor(() => window.document.querySelector("#settings-form"), "设置页未完成挂载");

	return {
		calls,
		core,
		document: window.document,
		ports,
		storageChanged,
		timers,
		window,
		get copiedText() {
			return copiedText;
		},
		clearCalls() {
			calls.length = 0;
		},
		unload() {
			window.dispatchEvent(new window.Event("beforeunload"));
		},
		cleanup() {
			window.dispatchEvent(new window.Event("beforeunload"));
			timers.restore();
			restoreChrome();
			restoreWindow();
			window.close();
		},
	};
}

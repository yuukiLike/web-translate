import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const catalogSource = readFileSync(
	new URL("../chrome-extension/generated/provider-catalog.js", import.meta.url),
	"utf8",
);
const coreSource = readFileSync(
	new URL("../chrome-extension/shared/core.js", import.meta.url),
	"utf8",
);
const manifest = JSON.parse(
	readFileSync(new URL("../chrome-extension/manifest.json", import.meta.url), "utf8"),
);
const backgroundSource = readFileSync(
	new URL("../chrome-extension/background/service-worker.js", import.meta.url),
	"utf8",
).replace(
	/^import "\.\.\/(?:generated\/provider-(?:catalog|runtime)|shared\/core)\.js";\s*/gmu,
	"",
);
const extensionUrl = "chrome-extension://background-test/";

function clone(value) {
	return value === undefined ? undefined : structuredClone(value);
}

function createStorageArea(initial = {}) {
	const data = clone(initial);

	function select(keys) {
		if (keys === null || keys === undefined) {
			return clone(data);
		}
		if (typeof keys === "string") {
			return Object.hasOwn(data, keys) ? { [keys]: clone(data[keys]) } : {};
		}
		if (Array.isArray(keys)) {
			return Object.fromEntries(
				keys.filter((key) => Object.hasOwn(data, key)).map((key) => [key, clone(data[key])]),
			);
		}
		return Object.fromEntries(
			Object.entries(keys).map(([key, fallback]) => [
				key,
				Object.hasOwn(data, key) ? clone(data[key]) : clone(fallback),
			]),
		);
	}

	return {
		data,
		async get(keys) {
			return select(keys);
		},
		async set(values) {
			for (const [key, value] of Object.entries(values)) {
				data[key] = clone(value);
			}
		},
		async remove(keys) {
			for (const key of Array.isArray(keys) ? keys : [keys]) {
				delete data[key];
			}
		},
		async getBytesInUse(keys) {
			return new TextEncoder().encode(JSON.stringify(select(keys))).byteLength;
		},
		async setAccessLevel() {},
	};
}

function createChromeEvent() {
	const listeners = [];
	return {
		listeners,
		addListener(listener) {
			listeners.push(listener);
		},
	};
}

function createDeepSeekSettings(overrides = {}) {
	return {
		provider: "deepseek",
		targetMode: "auto",
		translateDynamicContent: true,
		concurrency: 2,
		debugLogging: false,
		deepseek: {
			apiKey: "sk-example-secret",
			model: "deepseek-v4-flash",
			...overrides,
		},
	};
}

function createWebpageSender({ id = 7, incognito = false, url = "https://page.example/article" } = {}) {
	return {
		url,
		tab: { id, incognito, url },
	};
}

function createHarness({ settings, fetchHandler, runtimeHandler }) {
	const local = createStorageArea(settings ? { settings } : {});
	const session = createStorageArea();
	const onInstalled = createChromeEvent();
	const onMessage = createChromeEvent();
	const onConnect = createChromeEvent();
	const onClicked = createChromeEvent();
	const onContextMenuClicked = createChromeEvent();
	const contextMenuItems = new Map();
	const actionTitles = [];
	const createdTabs = [];
	const requests = [];
	const runtimeRequests = [];
	let identifier = 0;
	let optionsOpenCount = 0;
	const chrome = {
		action: {
			onClicked,
			async setBadgeText() {},
			async setBadgeBackgroundColor() {},
			async setTitle(details) {
				actionTitles.push(clone(details));
			},
		},
		contextMenus: {
			onClicked: onContextMenuClicked,
			async removeAll() {
				contextMenuItems.clear();
			},
			create(item) {
				contextMenuItems.set(item.id, clone(item));
				return item.id;
			},
			async update(id, changes) {
				const item = contextMenuItems.get(id);
				if (!item) {
					throw new Error(`unknown context menu: ${id}`);
				}
				contextMenuItems.set(id, { ...item, ...clone(changes) });
			},
		},
		permissions: {
			async contains() {
				return true;
			},
			async remove() {
				return true;
			},
		},
			runtime: {
			onInstalled,
			onMessage,
			onConnect,
			getURL(path = "") {
				return `${extensionUrl}${path}`;
			},
			getManifest() {
				return clone(manifest);
			},
			async openOptionsPage() {
				optionsOpenCount += 1;
			},
		},
		scripting: {
			async insertCSS() {},
			async executeScript() {},
		},
		storage: { local, session },
		tabs: {
			async create(details) {
				createdTabs.push(clone(details));
				return { id: createdTabs.length, ...clone(details) };
			},
		},
	};
	const context = vm.createContext({
		AbortController,
		Date,
		Error,
		Math,
		TextEncoder,
		URL,
		URLSearchParams,
		chrome,
		clearTimeout,
		crypto: {
			randomUUID() {
				identifier += 1;
				return `test-id-${identifier}`;
			},
		},
		async fetch(url, init = {}) {
			const request = { url: String(url), init };
			requests.push(request);
			if (typeof fetchHandler !== "function") {
				throw new Error(`unexpected request: ${request.url}`);
			}
			return await fetchHandler(request);
		},
		globalThis: null,
		setTimeout,
	});
	context.globalThis = context;
	vm.runInContext(catalogSource, context, { filename: "provider-catalog.js" });
	vm.runInContext(coreSource, context, { filename: "core.js" });
	context.BilingualTranslatorProviderRuntime = Object.freeze({
		async generateTranslation(request) {
			runtimeRequests.push({
				providerId: request.providerId,
				apiKey: request.apiKey,
				modelId: request.modelId,
				instructions: request.instructions,
				messages: clone(request.messages),
				maxOutputTokens: request.maxOutputTokens,
			});
			if (typeof runtimeHandler !== "function") {
				throw new Error("unexpected model provider request");
			}
			return await runtimeHandler(request);
		},
	});
	vm.runInContext(backgroundSource, context, { filename: "service-worker.js" });

	async function sendMessage(message, sender = { url: `${extensionUrl}options/index.html` }) {
		assert.equal(onMessage.listeners.length, 1);
		return await new Promise((resolve) => {
			const keepsChannelOpen = onMessage.listeners[0](clone(message), clone(sender), (response) => {
				resolve(clone(response));
			});
			assert.equal(keepsChannelOpen, true);
		});
	}

	return {
		actionTitles,
		chrome,
		contextMenuItems,
		createdTabs,
		get optionsOpenCount() {
			return optionsOpenCount;
		},
		local,
		onContextMenuClicked,
		requests,
		runtimeRequests,
		sendMessage,
		session,
	};
}

async function waitFor(predicate) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("condition was not met");
}

test("action menu exposes version 0.4.0 and toggles debug without changing credentials", async () => {
	const settings = createDeepSeekSettings();
	const harness = createHarness({ settings });

	await waitFor(() => harness.contextMenuItems.size === 3);
	assert.equal(manifest.version, "0.4.0");
	assert.ok(manifest.permissions.includes("contextMenus"));
	assert.equal(harness.contextMenuItems.get("action-extension-version").title, "当前版本 v0.4.0");
	assert.equal(harness.contextMenuItems.get("action-debug-logging").checked, false);
	assert.ok(
		harness.actionTitles.some(
			(details) => details.title === "翻译/恢复当前网页 · v0.4.0 · 调试已关闭",
		),
	);

	assert.equal(harness.onContextMenuClicked.listeners.length, 1);
	harness.onContextMenuClicked.listeners[0]({
		menuItemId: "action-debug-logging",
		checked: true,
	});
	await waitFor(() => harness.local.data.settings?.debugLogging === true);
	assert.equal(harness.local.data.settings.deepseek.apiKey, "sk-example-secret");
	assert.equal(harness.contextMenuItems.get("action-debug-logging").checked, true);

	harness.onContextMenuClicked.listeners[0]({ menuItemId: "action-open-debug-panel" });
	await waitFor(() => harness.createdTabs.length === 1);
	assert.deepEqual(harness.createdTabs[0], {
		url: `${extensionUrl}options/index.html#debug`,
	});
});

test("explicit DeepSeek runtime translates and records rich metadata without secrets or text", async () => {
	const apiKey = "sk-secret-never-log";
	const querySecret = "private-query-token";
	const sourceText = "hello";
	const translatedText = "translated output";
	const settings = createDeepSeekSettings({ apiKey });
	const harness = createHarness({
		settings: { ...settings, debugLogging: true },
		async runtimeHandler(request) {
			request.onRequestEvent({
				eventType: "request-start",
				requestId: "provider-request-1",
				endpoint: `https://api.deepseek.com/chat/completions?token=${querySecret}`,
				method: "POST",
				status: "started",
			});
			request.onRequestEvent({
				eventType: "request-end",
				requestId: "provider-request-1",
				endpoint: `https://api.deepseek.com/chat/completions?token=${querySecret}`,
				method: "POST",
				httpStatus: 200,
				elapsedMs: 42,
				status: "success",
				retryable: false,
			});
			return {
				text: JSON.stringify({
					translations: [{ id: "segment-1", text: translatedText }],
				}),
				finishReason: "stop",
				rawFinishReason: "stop",
				responseId: "response-1",
				responseModel: "deepseek-v4-flash",
				usage: {
					inputTokens: 12,
					outputTokens: 4,
					cacheReadTokens: 3,
					cacheWriteTokens: 0,
					noCacheTokens: 9,
				},
				warningCount: 0,
			};
		},
	});
	const webpageSender = createWebpageSender();

	assert.deepEqual(
		await harness.sendMessage({ type: "START_RUN", runId: "run-1" }, webpageSender),
		{
			ok: true,
			settings: {
				provider: "deepseek",
				targetMode: "auto",
				translateDynamicContent: true,
				concurrency: 2,
			},
		},
	);
	const translation = await harness.sendMessage(
		{
			type: "TRANSLATE_BATCH",
			runId: "run-1",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "segment-1", text: sourceText }],
		},
		webpageSender,
	);
	assert.equal(translation.ok, true);
	assert.deepEqual(translation.results, [{ id: "segment-1", text: translatedText }]);
	assert.equal(harness.requests.length, 0);
	assert.equal(harness.runtimeRequests.length, 1);
	assert.equal(harness.runtimeRequests[0].providerId, "deepseek");
	assert.equal(harness.runtimeRequests[0].apiKey, apiKey);
	assert.equal(harness.runtimeRequests[0].modelId, "deepseek-v4-flash");
	assert.match(harness.runtimeRequests[0].instructions, /translation engine/u);
	assert.deepEqual(
		harness.runtimeRequests[0].messages.map((message) => message.role),
		["user"],
	);
	assert.match(harness.runtimeRequests[0].messages[0].content, /hello/u);

	const debugResponse = await harness.sendMessage({ type: "GET_DEBUG_LOGS" });
	assert.equal(debugResponse.ok, true);
	assert.ok(debugResponse.events.some((event) => event.eventType === "run.started"));
	assert.ok(debugResponse.events.some((event) => event.eventType === "model.request.started"));
	assert.ok(debugResponse.events.some((event) => event.eventType === "sdk.request-start"));
	assert.ok(debugResponse.events.some((event) => event.eventType === "sdk.request-end"));
	const responseEvent = debugResponse.events.find(
		(event) => event.eventType === "model.response.validated",
	);
	assert.equal(responseEvent.providerAdapter, "@ai-sdk/deepseek");
	assert.equal(responseEvent.inferencePolicy, "thinking-disabled");
	assert.equal(responseEvent.responseId, "response-1");
	assert.equal(responseEvent.responseModel, "deepseek-v4-flash");
	assert.equal(responseEvent.finishReason, "stop");
	assert.equal(responseEvent.cacheReadTokens, 3);
	assert.equal(
		debugResponse.events.find((event) => event.eventType === "sdk.request-end").endpoint,
		"https://api.deepseek.com/chat/completions",
	);
	assert.ok(debugResponse.events.every((event) => !Object.hasOwn(event, "headers")));
	assert.ok(debugResponse.events.every((event) => !Object.hasOwn(event, "body")));
	const serializedDebugEvents = JSON.stringify(harness.session.data["debug-events-v1"]);
	assert.ok(!serializedDebugEvents.includes(apiKey));
	assert.ok(!serializedDebugEvents.includes(querySecret));
	assert.ok(!serializedDebugEvents.includes("Authorization"));
	assert.ok(!serializedDebugEvents.includes(sourceText));
	assert.ok(!serializedDebugEvents.includes(translatedText));

	const denied = await harness.sendMessage({ type: "GET_DEBUG_LOGS" }, webpageSender);
	assert.equal(denied.ok, false);
	assert.match(denied.error, /无权读取敏感设置/u);
});

test("extension-only settings messages authorize before parsing sensitive changes", async () => {
	const settings = createDeepSeekSettings();
	const harness = createHarness({ settings });
	const webpageSender = createWebpageSender();
	const response = await harness.sendMessage(
		{
			type: "SAVE_SETTINGS",
			settings: createDeepSeekSettings({ apiKey: "stolen-write" }),
		},
		webpageSender,
	);

	assert.equal(response.ok, false);
	assert.match(response.error, /无权读取敏感设置/u);
	assert.equal(harness.local.data.settings.deepseek.apiKey, settings.deepseek.apiKey);
});

test("SET_DEBUG_LOGGING is extension-only and preserves every other setting", async () => {
	const settings = createDeepSeekSettings({ apiKey: "sk-toggle-secret" });
	const harness = createHarness({ settings });
	const before = await harness.sendMessage({ type: "GET_OPTIONS_STATE" });

	assert.equal(before.settings.debugLogging, false);
	assert.deepEqual(await harness.sendMessage({ type: "SET_DEBUG_LOGGING", enabled: true }), {
		ok: true,
		debugLogging: true,
	});

	const afterEnable = await harness.sendMessage({ type: "GET_OPTIONS_STATE" });
	const { debugLogging: beforeDebugLogging, ...beforeOtherSettings } = before.settings;
	const { debugLogging: afterDebugLogging, ...afterOtherSettings } = afterEnable.settings;
	assert.equal(beforeDebugLogging, false);
	assert.equal(afterDebugLogging, true);
	assert.deepEqual(afterOtherSettings, beforeOtherSettings);
	assert.equal(afterOtherSettings.deepseek.apiKey, "sk-toggle-secret");

	const denied = await harness.sendMessage(
		{ type: "SET_DEBUG_LOGGING", enabled: false },
		createWebpageSender({ id: 8 }),
	);
	assert.equal(denied.ok, false);
	assert.match(denied.error, /无权读取敏感设置/u);
	assert.deepEqual(
		(await harness.sendMessage({ type: "GET_OPTIONS_STATE" })).settings,
		afterEnable.settings,
	);
});

test("SET_DEBUG_LOGGING applies live across existing run snapshots", async () => {
	const harness = createHarness({
		settings: createDeepSeekSettings(),
		async runtimeHandler(request) {
			const payload = JSON.parse(request.messages[0].content);
			return {
				text: JSON.stringify({
					translations: payload.segments.map((segment) => ({
						id: segment.id,
						text: `translated-${segment.id}`,
					})),
				}),
				finishReason: "stop",
				rawFinishReason: "stop",
				usage: { inputTokens: 4, outputTokens: 2 },
				warningCount: 0,
			};
		},
	});
	const webpageSender = createWebpageSender({ id: 11 });

	await harness.sendMessage({ type: "START_RUN", runId: "live-enable" }, webpageSender);
	assert.equal(
		harness.session.data["run-snapshot:11:live-enable"].settings.debugLogging,
		false,
	);
	await harness.sendMessage({ type: "SET_DEBUG_LOGGING", enabled: true });
	assert.equal(
		harness.session.data["run-snapshot:11:live-enable"].settings.debugLogging,
		false,
	);

	const enabledTranslation = await harness.sendMessage(
		{
			type: "TRANSLATE_BATCH",
			runId: "live-enable",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "enabled", text: "first request" }],
		},
		webpageSender,
	);
	assert.equal(enabledTranslation.ok, true);
	const enabledLogs = await harness.sendMessage({ type: "GET_DEBUG_LOGS" });
	assert.ok(
		enabledLogs.events.some(
			(event) => event.eventType === "model.request.started" && event.runId === "live-enable",
		),
	);
	assert.ok(
		!enabledLogs.events.some(
			(event) => event.eventType === "run.started" && event.runId === "live-enable",
		),
	);

	await harness.sendMessage({ type: "START_RUN", runId: "live-disable" }, webpageSender);
	assert.equal(
		harness.session.data["run-snapshot:11:live-disable"].settings.debugLogging,
		true,
	);
	await harness.sendMessage({ type: "SET_DEBUG_LOGGING", enabled: false });
	await harness.sendMessage({ type: "CLEAR_DEBUG_LOGS" });

	const disabledTranslation = await harness.sendMessage(
		{
			type: "TRANSLATE_BATCH",
			runId: "live-disable",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "disabled", text: "second request" }],
		},
		webpageSender,
	);
	assert.equal(disabledTranslation.ok, true);
	assert.equal(harness.runtimeRequests.length, 2);
	assert.equal(harness.requests.length, 0);
	assert.deepEqual(await harness.sendMessage({ type: "GET_DEBUG_LOGS" }), {
		ok: true,
		events: [],
	});
});

test("incognito cache messages bypass payload validation and snapshot access", async () => {
	const harness = createHarness({ settings: createDeepSeekSettings() });
	const incognitoSender = createWebpageSender({ id: 8, incognito: true });

	assert.deepEqual(await harness.sendMessage({ type: "CACHE_LOOKUP" }, incognitoSender), {
		ok: true,
		results: [],
	});
	assert.deepEqual(await harness.sendMessage({ type: "CACHE_STORE" }, incognitoSender), {
		ok: true,
	});
	assert.equal(
		Object.keys(harness.local.data).some((key) => key.startsWith("translation-cache:")),
		false,
	);
	assert.equal(harness.runtimeRequests.length, 0);
	assert.equal(harness.requests.length, 0);
});

test("persistent cache handles full and mixed hits while preserving usage and result order", async () => {
	const harness = createHarness({
		settings: createDeepSeekSettings(),
		async runtimeHandler(request) {
			const payload = JSON.parse(request.messages[0].content);
			assert.deepEqual(payload.segments, [{ id: "missing", text: "world" }]);
			return {
				text: JSON.stringify({
					translations: [{ id: "missing", text: "世界" }],
				}),
				finishReason: "stop",
				rawFinishReason: "stop",
				usage: {
					inputTokens: 8,
					outputTokens: 2,
					cacheReadTokens: 3,
				},
				warningCount: 0,
			};
		},
	});
	const webpageSender = createWebpageSender({ id: 9 });
	await harness.sendMessage({ type: "START_RUN", runId: "cache-run" }, webpageSender);
	assert.deepEqual(
		await harness.sendMessage(
			{
				type: "CACHE_STORE",
				runId: "cache-run",
				sourceLanguage: "en",
				targetLanguage: "zh",
				entries: [{ id: "cached", text: "hello", translation: "你好" }],
			},
			webpageSender,
		),
		{ ok: true },
	);

	const fullHit = await harness.sendMessage(
		{
			type: "TRANSLATE_BATCH",
			runId: "cache-run",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "cached", text: "hello" }],
		},
		webpageSender,
	);
	assert.deepEqual(fullHit, {
		ok: true,
		results: [{ id: "cached", text: "你好" }],
		cacheHits: 1,
	});
	assert.equal(harness.runtimeRequests.length, 0);

	const mixedHit = await harness.sendMessage(
		{
			type: "TRANSLATE_BATCH",
			runId: "cache-run",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [
				{ id: "cached", text: "hello" },
				{ id: "missing", text: "world" },
			],
		},
		webpageSender,
	);
	assert.deepEqual(mixedHit, {
		ok: true,
		results: [
			{ id: "cached", text: "你好" },
			{ id: "missing", text: "世界" },
		],
		cacheHits: 1,
	});
	assert.equal(harness.runtimeRequests.length, 1);

	const cacheLookup = await harness.sendMessage(
		{
			type: "CACHE_LOOKUP",
			runId: "cache-run",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [
				{ id: "cached", text: "hello" },
				{ id: "missing", text: "world" },
			],
		},
		webpageSender,
	);
	assert.deepEqual(cacheLookup.results, [
		{ id: "cached", text: "你好" },
		{ id: "missing", text: "世界" },
	]);

	const usage = Object.values(harness.local.data.usage)[0].deepseek;
	assert.equal(usage.apiCalls, 1);
	assert.equal(usage.charactersSubmitted, 5);
	assert.equal(usage.cachedCharacters, 10);
	assert.equal(usage.inputTokens, 8);
	assert.equal(usage.cachedInputTokens, 3);
	assert.equal(usage.outputTokens, 2);
});

test("clearing cache rejects webpage callers and invalidates earlier run snapshots", async () => {
	const harness = createHarness({ settings: createDeepSeekSettings() });
	const webpageSender = createWebpageSender({ id: 10 });
	await harness.sendMessage({ type: "START_RUN", runId: "stale-cache-run" }, webpageSender);
	const cacheStoreMessage = {
		type: "CACHE_STORE",
		runId: "stale-cache-run",
		sourceLanguage: "en",
		targetLanguage: "zh",
		entries: [{ id: "cached", text: "hello", translation: "你好" }],
	};
	await harness.sendMessage(cacheStoreMessage, webpageSender);

	const denied = await harness.sendMessage({ type: "CLEAR_CACHE" }, webpageSender);
	assert.equal(denied.ok, false);
	assert.match(denied.error, /无权读取敏感设置/u);
	const beforeClear = await harness.sendMessage(
		{
			type: "CACHE_LOOKUP",
			runId: "stale-cache-run",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "cached", text: "hello" }],
		},
		webpageSender,
	);
	assert.deepEqual(beforeClear.results, [{ id: "cached", text: "你好" }]);

	const cleared = await harness.sendMessage({ type: "CLEAR_CACHE" });
	assert.equal(cleared.ok, true);
	assert.ok(cleared.removed > 0);
	assert.deepEqual(await harness.sendMessage(cacheStoreMessage, webpageSender), { ok: true });
	const afterClear = await harness.sendMessage(
		{
			type: "CACHE_LOOKUP",
			runId: "stale-cache-run",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segments: [{ id: "cached", text: "hello" }],
		},
		webpageSender,
	);
	assert.deepEqual(afterClear.results, []);
	assert.equal(
		Object.keys(harness.local.data).some((key) => key.startsWith("translation-cache:")),
		false,
	);
});

test("manifest keeps fixed hosts installed and custom hosts only optional", async () => {
	assert.ok(!manifest.host_permissions.some((pattern) => pattern.includes("models.dev")));
	assert.ok(!manifest.host_permissions.some((pattern) => pattern === "https://*/*"));
	assert.ok(manifest.host_permissions.includes("https://api.openai.com/*"));
	assert.ok(manifest.host_permissions.includes("https://generativelanguage.googleapis.com/*"));
	assert.ok(manifest.host_permissions.includes("https://api.anthropic.com/*"));
	assert.deepEqual(manifest.optional_host_permissions, [
		"http://localhost/*",
		"http://127.0.0.1/*",
		"https://*/*",
	]);

	const harness = createHarness({ settings: createDeepSeekSettings() });
	const response = await harness.sendMessage({ type: "GET_MODEL_CATALOG", refresh: true });
	assert.equal(response.ok, false);
	assert.match(response.error, /未知消息类型/u);
});

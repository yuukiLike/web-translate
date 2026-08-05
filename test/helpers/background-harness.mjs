import { createCore } from "../../src/core/create-core.js";
import { createCatalogFixture } from "./catalog-fixture.mjs";

export const backgroundCatalog = await createCatalogFixture();
export const backgroundCore = createCore(backgroundCatalog);
const extensionOrigin = "chrome-extension://background-test/";

export function createConfiguredSettings(overrides = {}) {
	const defaults = backgroundCore.createDefaultSettings();
	return backgroundCore.normalizeSettings({
		...defaults,
		provider: "deepseek",
		...overrides,
		deepseek: {
			...defaults.deepseek,
			apiKey: "sk-background-test",
			model: "deepseek-v4-flash",
			...overrides.deepseek,
		},
	});
}

function createStorageArea(initial = {}) {
	const data = structuredClone(initial);

	function select(keys) {
		if (keys === null || keys === undefined) {
			return structuredClone(data);
		}
		if (typeof keys === "string") {
			return Object.hasOwn(data, keys) ? { [keys]: structuredClone(data[keys]) } : {};
		}
		if (Array.isArray(keys)) {
			return Object.fromEntries(
				keys
					.filter((key) => Object.hasOwn(data, key))
					.map((key) => [key, structuredClone(data[key])]),
			);
		}
		return Object.fromEntries(
			Object.entries(keys).map(([key, fallback]) => [
				key,
				Object.hasOwn(data, key) ? structuredClone(data[key]) : structuredClone(fallback),
			]),
		);
	}

	return {
		data,
		accessLevels: [],
		async get(keys) {
			return select(keys);
		},
		async set(values) {
			Object.assign(data, structuredClone(values));
		},
		async remove(keys) {
			for (const key of Array.isArray(keys) ? keys : [keys]) {
				delete data[key];
			}
		},
		async getBytesInUse(keys) {
			return new TextEncoder().encode(JSON.stringify(select(keys))).byteLength;
		},
		async setAccessLevel(details) {
			this.accessLevels.push(structuredClone(details));
		},
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

export function createChromeHarness(options = {}) {
	const settings = options.settings ?? createConfiguredSettings();
	const local = options.local ?? createStorageArea({ [backgroundCore.SETTINGS_KEY]: settings });
	const session = options.session ?? createStorageArea();
	const badgeTexts = [];
	const actionTitles = [];
	const contextMenuItems = new Map();
	const createdTabs = [];
	const activeTabs = options.activeTabs ?? [
		{ id: 7, incognito: false, url: "https://page.example/article" },
	];
	const scriptExecutions = [];
	const tabQueries = [];
	const events = {
		onConnect: createChromeEvent(),
		onContextMenuClicked: createChromeEvent(),
		onInstalled: createChromeEvent(),
		onMessage: createChromeEvent(),
		onTabRemoved: createChromeEvent(),
	};
	let optionsOpenCount = 0;

	const chrome = {
		action: {
			async setBadgeText(details) {
				badgeTexts.push(details.text);
			},
			async setBadgeBackgroundColor() {},
			async setTitle(details) {
				actionTitles.push(structuredClone(details));
			},
		},
		contextMenus: {
			onClicked: events.onContextMenuClicked,
			async removeAll() {
				contextMenuItems.clear();
			},
			create(item) {
				contextMenuItems.set(item.id, structuredClone(item));
				return item.id;
			},
			async update(id, changes) {
				const previous = contextMenuItems.get(id) ?? { id };
				contextMenuItems.set(id, { ...previous, ...structuredClone(changes) });
			},
		},
		permissions: {
			async contains() {
				return options.permissionGranted !== false;
			},
		},
		runtime: {
			onConnect: events.onConnect,
			onInstalled: events.onInstalled,
			onMessage: events.onMessage,
			getManifest() {
				return { version: "0.4.0" };
			},
			getURL(path = "") {
				return `${extensionOrigin}${path}`;
			},
			async openOptionsPage() {
				optionsOpenCount += 1;
			},
		},
		scripting: {
			async insertCSS(details) {
				scriptExecutions.push({ type: "css", details: structuredClone(details) });
			},
			async executeScript(details) {
				scriptExecutions.push({ type: "script", details: structuredClone(details) });
			},
		},
		storage: { local, session },
		tabs: {
			onRemoved: events.onTabRemoved,
			async query(details) {
				tabQueries.push(structuredClone(details));
				return structuredClone(activeTabs);
			},
			async create(details) {
				createdTabs.push(structuredClone(details));
				return { id: createdTabs.length, ...structuredClone(details) };
			},
		},
	};

	return {
		actionTitles,
		badgeTexts,
		chrome,
		contextMenuItems,
		createdTabs,
		events,
		local,
		get optionsOpenCount() {
			return optionsOpenCount;
		},
		scriptExecutions,
		session,
		tabQueries,
	};
}

export function createWebpageSender(options = {}) {
	const url = options.url ?? "https://page.example/article";
	return {
		url,
		tab: {
			id: options.tabId ?? 7,
			incognito: options.incognito ?? false,
			url,
		},
	};
}

export function createExtensionSender(path = "options/index.html") {
	return { url: `${extensionOrigin}${path}` };
}

export function createProviderRuntimeFake() {
	const requests = [];
	return {
		requests,
		async generateTranslation(request) {
			requests.push(structuredClone({
				providerId: request.providerId,
				modelId: request.modelId,
				messages: request.messages,
				captureRequestBody: request.captureRequestBody === true,
			}));
			if (request.captureRequestBody === true && typeof request.onRequestEvent === "function") {
				request.onRequestEvent({
					eventType: "request-start",
					requestId: "provider-request-test",
					endpoint: "https://api.deepseek.com/chat/completions",
					method: "POST",
					status: "started",
					requestBody: JSON.stringify({
						model: request.modelId,
						max_tokens: request.maxOutputTokens,
						messages: [
							{ role: "system", content: request.instructions },
							...request.messages,
						],
						thinking: { type: "disabled" },
					}),
				});
			}
			const payload = JSON.parse(request.messages[0].content);
			return {
				text: JSON.stringify({
					translations: payload.segments.map((segment) => ({
						id: segment.id,
						text: `译文：${segment.text}`,
					})),
				}),
				finishReason: "stop",
				usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0 },
			};
		},
	};
}

export function sendAppMessage(app, message, sender = createExtensionSender()) {
	return new Promise((resolve) => {
		const keepsChannelOpen = app.onMessage(
			structuredClone(message),
			structuredClone(sender),
			(response) => resolve(structuredClone(response)),
		);
		if (keepsChannelOpen !== true) {
			throw new Error("后台消息监听器必须保持响应通道开启");
		}
	});
}

export function createFakeClock() {
	let now = 0;
	let sequence = 0;
	const tasks = [];

	function wait(milliseconds) {
		return new Promise((resolve) => {
			tasks.push({ at: now + milliseconds, resolve, sequence: sequence += 1 });
		});
	}

	async function advanceBy(milliseconds) {
		now += milliseconds;
		const due = tasks
			.filter((task) => task.at <= now)
			.sort((left, right) => left.at - right.at || left.sequence - right.sequence);
		for (const task of due) {
			tasks.splice(tasks.indexOf(task), 1);
			task.resolve();
		}
		await flushMicrotasks();
	}

	return { advanceBy, wait };
}

export async function flushMicrotasks() {
	await Promise.resolve();
	await Promise.resolve();
}

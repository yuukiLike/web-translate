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
		addListener(listener) { listeners.push(listener); },
	};
}

export function createChromeHarness(options = {}) {
	const settings = options.settings ?? createConfiguredSettings();
	const local = options.local ?? createStorageArea({ [backgroundCore.SETTINGS_KEY]: settings });
	const badgeTexts = [];
	const activeTabs = options.activeTabs ?? [
		{ id: 7, incognito: false, url: "https://page.example/article" },
	];
	const frames = options.frames ?? activeTabs.map((tab) => ({
		tabId: tab.id, frameId: 0, documentId: `document-${tab.id}-0`, documentLifecycle: "active", url: tab.url,
	}));
	// 既有后台用例从用户已经启用翻译开始；安全入口用例明确设置 pageAuthorized: false。
	const authorizedPages = options.pageAuthorized === false ? {} : Object.fromEntries(activeTabs.map((tab) => [
		`reading-page:${tab.id}`, { active: true, selectionActive: true, origin: new URL(tab.url).origin,
			documents: frames.filter((frame) => frame.tabId === tab.id).map(({ frameId, documentId }) => ({ frameId, documentId })),
		},
	]));
	const session = options.session ?? createStorageArea(authorizedPages);
	const scriptExecutions = [];
	const tabQueries = [];
	const pageStates = new Map();
	const installed = new Set();
	const grantedOrigins = [...(options.grantedOrigins ?? [])];
	const removedOrigins = [];
	let createdTabCount = 0;

	const chrome = {
		action: {
			async setIcon() {},
			async setBadgeTextColor() {},
			async getBadgeText() { return ""; },
			async setBadgeText(details) {
				badgeTexts.push(details.text);
			},
			async setBadgeBackgroundColor() {},
			async setTitle() {},
		},
		contextMenus: {
			onClicked: createChromeEvent(),
			async removeAll() {},
			create: (item) => item.id,
			async update() {},
		},
		permissions: {
			async getAll() { return { origins: [...grantedOrigins] }; },
			async remove({ origins }) {
				if (options.removePermissionFails) return false;
				removedOrigins.push(...origins);
				for (const origin of origins) {
					const index = grantedOrigins.indexOf(origin);
					if (index !== -1) grantedOrigins.splice(index, 1);
				}
				return true;
			},
			async contains() { return options.permissionGranted !== false; },
		},
		runtime: {
			id: "background-test",
			onConnect: createChromeEvent(),
			onInstalled: createChromeEvent(),
			onMessage: createChromeEvent(),
			getManifest: () => ({ version: "0.4.0" }),
			getURL: (path = "") => `${extensionOrigin}${path}`,
			async openOptionsPage() {},
		},
		scripting: {
			async insertCSS(details) {
				scriptExecutions.push({ type: "css", details: structuredClone(details) });
			},
			async executeScript(details) {
				const { func, ...serializable } = details;
				scriptExecutions.push({ type: "script", details: { ...structuredClone(serializable), ...(func ? { func: "probe" } : {}) } });
				const documentId = details.target.documentIds?.[0];
				const result = installed.has(documentId);
				if (details.files) installed.add(documentId);
				return [{ result, documentId }];
			},
		},
		webNavigation: {
			async getAllFrames({ tabId }) { return structuredClone(frames.filter((frame) => frame.tabId === tabId)); },
		},
		storage: { local, session },
		tabs: {
			onRemoved: createChromeEvent(),
			async sendMessage(tabId, message, target) {
				const key = `${tabId}:${target.documentId ?? "main"}`;
				if (message.type === "BT_GET_PAGE_STATE") return pageStates.get(`${tabId}:document-${tabId}-0`) ?? { active: false, selectionActive: false };
				if (message.type === "BT_PAGE_COMMAND" && message.command === "sync") {
					pageStates.set(key, { active: message.active, selectionActive: message.selectionActive });
				}
				return { ok: true, ...pageStates.get(key) };
			},
			async query(details) {
				tabQueries.push(structuredClone(details));
				return structuredClone(activeTabs);
			},
			async create(details) {
				createdTabCount += 1;
				return { id: createdTabCount, ...structuredClone(details) };
			},
		},
	};

	return {
		badgeTexts, chrome, local, frames, grantedOrigins, removedOrigins,
		scriptExecutions, session, tabQueries,
	};
}

export function createWebpageSender(options = {}) {
	const url = options.url ?? "https://page.example/article";
	const tabId = options.tabId ?? 7;
	const frameId = options.frameId ?? 0;
	return {
		id: "background-test",
		url,
		frameId,
		origin: new URL(url).origin,
		documentId: options.documentId ?? `document-${tabId}-${frameId}`,
		documentLifecycle: "active",
		tab: {
			id: tabId,
			incognito: options.incognito ?? false,
			url: options.tabUrl ?? url,
		},
	};
}

export function createExtensionSender(path = "options/index.html") {
	return { id: "background-test", url: `${extensionOrigin}${path}` };
}

export function createProviderRuntimeFake(options = {}) {
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
			if (typeof request.onRequestEvent === "function") {
				request.onRequestEvent({
					eventType: "request-start",
					requestId: `provider-request-test-${requests.length}`,
					endpoint: "https://api.deepseek.com/chat/completions",
					method: "POST",
					status: "started",
					...(request.captureRequestBody === true ? { requestBody: JSON.stringify({
						model: request.modelId,
						max_tokens: request.maxOutputTokens,
						messages: [
							{ role: "system", content: request.instructions },
							...request.messages,
						],
						thinking: { type: "disabled" },
					}) } : {}),
				});
			}
			const payload = JSON.parse(request.messages[0].content);
			const result = {
				text: JSON.stringify({
					translations: payload.segments.map((segment) => ({
						id: segment.id,
						text: `译文：${segment.text}`,
					})),
				}),
				finishReason: "stop",
			};
			if (options.omitUsage !== true) result.usage = { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0 };
			return result;
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

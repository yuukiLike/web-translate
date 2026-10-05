import { createIdentifier } from "./utilities.js";

const MAX_SELECTION_CHARACTERS = 12_000;

/** 划词复用翻译服务与缓存，但不参与整页运行的指针和进度。 */
export function createSelectionService({ core, validators, settingsStore, cacheStore, batchTranslator }) {
	const pending = new Map();

	function owner(sender) {
		if (!Number.isInteger(sender.tab?.id)) throw new Error("划词翻译必须来自网页");
		const tabId = sender.tab.id;
		const frameId = sender.frameId ?? 0;
		return { tabId, frameId, key: `${tabId}:${frameId}:${sender.documentId ?? sender.url ?? ""}` };
	}

	async function translate(message, sender) {
		const { tabId, frameId, key } = owner(sender);
		const requestId = validators.validateRunId(message.requestId);
		if (typeof message.text !== "string" || message.text.length > MAX_SELECTION_CHARACTERS) {
			throw new Error("选中文字过长，请选择不超过 12,000 个字符");
		}
		const text = core.normalizeSourceText(message.text);
		if (!text || !/\p{L}/u.test(text)) throw new Error("请先选择需要翻译的文字");
		pending.get(key)?.controller.abort();
		const task = { tabId, frameId, requestId, controller: new AbortController() };
		pending.set(key, task);
		const deadline = AbortSignal.timeout(60_000);
		const signal = AbortSignal.any([task.controller.signal, deadline]);
		try {
			const settings = await settingsStore.getSettings();
			signal.throwIfAborted();
			settingsStore.assertProviderConfigured(settings);
			await settingsStore.assertProviderPermission(settings);
			signal.throwIfAborted();
			const pair = core.getLanguagePair("", text, "auto", settings.targetMode);
			if (pair.sourceLanguage === pair.targetLanguage) {
				pair.targetLanguage = pair.sourceLanguage === "en" ? "zh" : "en";
			}
			const segments = core.splitText(text, 3_500).map((part, index) => ({ id: `selection-${index}`, text: part }));
			const limits = core.getProviderLimits(settings.provider);
			const batches = core.batchSegments(segments, limits.maximumCharacters, limits.maximumItems);
			const translations = new Map();
			const snapshot = {
				settings,
				cacheGeneration: cacheStore.getGeneration(),
				cacheScope: getOrigin(sender.url ?? sender.tab.url),
			};
			for (const [index, batch] of batches.entries()) {
				signal.throwIfAborted();
				const result = await batchTranslator.translate(
					snapshot,
					{ runId: `selection-${requestId}`, ...pair, segments: batch },
					sender.tab.id,
					!sender.tab.incognito,
					{ batchId: createIdentifier(), batchIndex: index + 1, queueDepth: batches.length - index - 1 },
					signal,
					{ incognito: sender.tab.incognito === true },
				);
				for (const item of result.results) translations.set(item.id, item.text);
			}
			signal.throwIfAborted();
			return { requestId, ...pair, text: segments.map((segment) => translations.get(segment.id)).join("\n") };
		} catch (error) {
			if (deadline.aborted && !task.controller.signal.aborted) {
				throw new Error("划词翻译超时，请重试或更换翻译服务");
			}
			throw error;
		} finally {
			if (pending.get(key) === task) pending.delete(key);
		}
	}

	function cancel(message, sender) {
		const { key } = owner(sender);
		validators.validateRunId(message.requestId);
		const task = pending.get(key);
		if (task?.requestId === message.requestId) {
			task.controller.abort();
			pending.delete(key);
		}
		return {};
	}

	function removeTab(tabId, frameId = null) {
		for (const [key, task] of pending) {
			if (task.tabId === tabId && (frameId === null || task.frameId === frameId)) {
				task.controller.abort();
				pending.delete(key);
			}
		}
	}

	return { translate, cancel, removeTab };
}

function getOrigin(value) {
	try {
		const url = new URL(value);
		return url.origin === "null" ? `${url.protocol}//local-file` : url.origin;
	} catch {
		return "unknown-origin";
	}
}

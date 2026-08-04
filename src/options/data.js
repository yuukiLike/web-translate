export const MODEL_PROVIDER_IDS = Object.freeze(["deepseek", "openai", "google", "anthropic"]);

const TOKEN_USAGE_PROVIDERS = new Set(MODEL_PROVIDER_IDS);
export const DEBUG_EVENT_LIMIT = 300;

export const PROVIDERS = Object.freeze([
	Object.freeze({
		id: "deepseek",
		name: "DeepSeek",
		cue: "默认推荐 · 成本优先",
		note: "关闭思考模式并逐段输出 JSON，兼顾翻译速度与成本。",
		kind: "model",
		recommended: true,
	}),
	Object.freeze({
		id: "openai",
		name: "OpenAI",
		cue: "推荐 · 稳定高吞吐",
		note: "适合需要稳定响应与高吞吐的翻译任务。",
		kind: "model",
		recommended: true,
	}),
	Object.freeze({
		id: "google",
		name: "Google Gemini",
		cue: "推荐 · 可用免费层",
		note: "免费层与配额以 Google 当前账号和区域政策为准。",
		kind: "model",
		recommended: true,
	}),
	Object.freeze({
		id: "azure",
		name: "Azure Translator",
		cue: "传统机器翻译",
		note: "区域应与 Azure 门户资源页面一致；全局单服务资源通常可留空。",
		kind: "azure",
		recommended: false,
	}),
	Object.freeze({
		id: "deepl",
		name: "DeepL API",
		cue: "传统机器翻译",
		note: "自动识别旧 API Free（:fx 密钥）与 Developer、Pro、Growth。",
		kind: "deepl",
		recommended: false,
	}),
	Object.freeze({
		id: "anthropic",
		name: "Anthropic",
		cue: "可选 · 高质量",
		note: "适合偏好 Claude 模型的高质量翻译任务。",
		kind: "model",
		recommended: false,
	}),
]);

export const TARGETS = Object.freeze([
	Object.freeze({
		id: "auto",
		name: "自动判断",
		cue: "中文页译英文，英文页译中文",
		note: "根据页面声明语言和正文内容判断翻译方向。",
	}),
	Object.freeze({
		id: "zh",
		name: "译为中文",
		cue: "英文 → 中文",
		note: "始终把符合条件的英文正文翻译为中文。",
	}),
	Object.freeze({
		id: "en",
		name: "译为英文",
		cue: "中文 → 英文",
		note: "始终把符合条件的中文正文翻译为英文。",
	}),
]);

export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorText(error) {
	return error instanceof Error && error.message ? error.message : "未知错误";
}

export function formatNumber(value) {
	const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
	return new Intl.NumberFormat("zh-CN").format(number);
}

function formatDecimal(value) {
	if (!Number.isFinite(value)) {
		return "—";
	}
	return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
}

function shortText(value, maximumLength) {
	return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function catalogModel(entryId, value) {
	if (!isRecord(value)) {
		return undefined;
	}
	const id = shortText(value.id, 300) || shortText(entryId, 300);
	if (!id) {
		return undefined;
	}
	const name = shortText(value.name, 180) || id;
	const details = [];
	const cost = isRecord(value.cost) ? value.cost : {};
	if (Number.isFinite(cost.input) || Number.isFinite(cost.output)) {
		details.push(`输入 $${formatDecimal(cost.input)} / 输出 $${formatDecimal(cost.output)} 每 1M token`);
	}
	const limits = isRecord(value.limits) ? value.limits : {};
	if (Number.isFinite(limits.context)) {
		details.push(`上下文 ${formatNumber(limits.context)} token`);
	}
	const identity = name === id ? name : `${name} — ${id}`;
	const label = details.length > 0 ? `${identity} · ${details.join(" · ")}` : identity;
	return { id, label, name };
}

function catalogDate(value) {
	const raw = shortText(value, 80);
	if (!raw) {
		return { dateText: "未知", dateTime: "" };
	}
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) {
		return { dateText: raw, dateTime: "" };
	}
	const dateTime = date.toISOString();
	const dateText = new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
	return { dateText, dateTime };
}

export function createCatalogInfo(catalog) {
	const models = Object.fromEntries(MODEL_PROVIDER_IDS.map((id) => [id, []]));
	const missingMessage = "固定本地模型目录未载入。请重新构建并重新加载扩展。";
	if (!isRecord(catalog) || !isRecord(catalog.providers)) {
		return {
			sha: "未知",
			dateText: "未知",
			dateTime: "",
			error: missingMessage,
			models,
		};
	}

	const source = isRecord(catalog.source) ? catalog.source : {};
	const commit = shortText(source.commit, 100);
	const date = catalogDate(source.fetchedAt);
	let complete = true;
	for (const id of MODEL_PROVIDER_IDS) {
		const provider = catalog.providers[id];
		if (!isRecord(provider) || !isRecord(provider.models)) {
			complete = false;
			continue;
		}
		const providerModels = Object.entries(provider.models)
			.map(([entryId, model]) => catalogModel(entryId, model))
			.filter((model) => model !== undefined);
		const defaultId = shortText(provider.defaultModelId, 300);
		providerModels.sort((left, right) => {
			if (left.id === defaultId) {
				return -1;
			}
			if (right.id === defaultId) {
				return 1;
			}
			return 0;
		});
		models[id] = providerModels;
		if (providerModels.length === 0) {
			complete = false;
		}
	}

	return {
		sha: commit ? commit.slice(0, 8) : "未知",
		dateText: date.dateText,
		dateTime: date.dateTime,
		error: complete ? "" : missingMessage,
		models,
	};
}

function defaultModelId(catalog, providerId) {
	if (!isRecord(catalog) || !isRecord(catalog.providers)) {
		return "";
	}
	const provider = catalog.providers[providerId];
	if (!isRecord(provider) || !isRecord(provider.models)) {
		return "";
	}
	const requested = shortText(provider.defaultModelId, 300);
	if (requested && Object.hasOwn(provider.models, requested)) {
		return requested;
	}
	for (const [entryId, model] of Object.entries(provider.models)) {
		const normalized = catalogModel(entryId, model);
		if (normalized) {
			return normalized.id;
		}
	}
	return "";
}

export function createFallbackSettings(catalog) {
	return {
		provider: "deepseek",
		targetMode: "auto",
		translateDynamicContent: true,
		concurrency: 2,
		debugLogging: false,
		azure: { apiKey: "", region: "" },
		deepl: { apiKey: "" },
		deepseek: { apiKey: "", model: defaultModelId(catalog, "deepseek") },
		openai: { apiKey: "", model: defaultModelId(catalog, "openai") },
		google: { apiKey: "", model: defaultModelId(catalog, "google") },
		anthropic: { apiKey: "", model: defaultModelId(catalog, "anthropic") },
	};
}

function metric(label, value) {
	return { label, value };
}

export function createUsageRows(allUsage, monthKey, getProviderName) {
	if (!isRecord(allUsage)) {
		return [];
	}
	const monthUsage = allUsage[monthKey];
	if (!isRecord(monthUsage)) {
		return [];
	}
	return Object.entries(monthUsage).map(([id, value]) => {
		const usage = isRecord(value) ? value : {};
		let finalMetric = metric("计费字符", formatNumber(usage.billedCharacters));
		if (TOKEN_USAGE_PROVIDERS.has(id)) {
			const input = formatNumber(usage.inputTokens);
			const output = formatNumber(usage.outputTokens);
			finalMetric = metric("输入 / 输出 token", `${input} / ${output}`);
		}
		let name = id;
		if (typeof getProviderName === "function") {
			const candidate = getProviderName(id);
			if (typeof candidate === "string" && candidate) {
				name = candidate;
			}
		}
		return {
			id,
			name,
			metrics: [
				metric("API 请求", formatNumber(usage.apiCalls)),
				metric("提交字符", formatNumber(usage.charactersSubmitted)),
				metric("缓存命中", formatNumber(usage.cachedCharacters)),
				finalMetric,
			],
		};
	});
}

export function normalizeDebugEvents(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((event) => isRecord(event)).slice(-DEBUG_EVENT_LIMIT);
}

function scalarText(value) {
	if (typeof value === "number" && Number.isFinite(value)) {
		return formatNumber(value);
	}
	return shortText(value, 160);
}

function validAuthority(value) {
	if (/^[a-z0-9.-]+(?::\d{1,5})?$/iu.test(value)) {
		return value;
	}
	if (/^\[[0-9a-f:.]+\](?::\d{1,5})?$/iu.test(value)) {
		return value;
	}
	return "";
}

function urlParts(value) {
	const input = shortText(value, 2_048);
	const match = /^(https?):\/\/([^/?#]+)([^?#]*)/iu.exec(input);
	if (!match) {
		return undefined;
	}
	const authority = match[2].slice(match[2].lastIndexOf("@") + 1);
	const host = validAuthority(authority);
	if (!host) {
		return undefined;
	}
	return {
		origin: `${match[1].toLowerCase()}://${host}`,
		host,
		path: match[3],
	};
}

export function formatApiHost(value) {
	const input = shortText(value, 2_048);
	const host = validAuthority(input);
	if (host) {
		return host.slice(0, 255);
	}
	const parts = urlParts(input);
	return parts ? parts.host.slice(0, 255) : "";
}

export function formatEndpoint(value) {
	const parts = urlParts(value);
	if (!parts) {
		return "";
	}
	return `${parts.origin}${parts.path}`.slice(0, 2_048);
}

function formatDebugTime(value) {
	let input = Date.now();
	if (typeof value === "number" || typeof value === "string") {
		input = value;
	}
	const date = new Date(input);
	if (Number.isNaN(date.getTime())) {
		return "时间未知";
	}
	return new Intl.DateTimeFormat("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

function languagePair(source, target) {
	if (typeof source !== "string" || typeof target !== "string") {
		return "";
	}
	return `${source} → ${target}`;
}

function withUnit(value, unit) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "";
	}
	return `${formatNumber(value)} ${unit}`;
}

function booleanText(value) {
	if (typeof value !== "boolean") {
		return "";
	}
	return value ? "是" : "否";
}

function debugFields(event) {
	const fields = [
		["序号", event.seq],
		["扩展版本", event.extensionVersion],
		["目录 SHA", event.catalogSourceSha],
		["Worker", event.workerInstanceId],
		["组件", event.component],
		["操作", event.operation],
		["服务", event.provider],
		["Adapter", event.providerAdapter],
		["API Host", formatApiHost(event.apiHost)],
		["推理策略", event.inferencePolicy],
		["模型", event.model],
		["响应 ID", event.responseId],
		["响应模型", event.responseModel],
		["结束原因", event.finishReason],
		["原始结束原因", event.rawFinishReason],
		["警告数", event.warningCount],
		["语言", languagePair(event.sourceLanguage, event.targetLanguage)],
		["方法", event.method],
		["端点", formatEndpoint(event.endpoint)],
		["尝试", event.attempt],
		["配置并发", event.configuredConcurrency],
		["批次序号", event.batchIndex],
		["批次数", event.batchCount],
		["队列深度", event.queueDepth],
		["段落", event.segmentCount],
		["原文字符", event.sourceCharacters],
		["缓存命中", event.cacheHits],
		["缓存未命中", event.cacheMisses],
		["HTTP", event.httpStatus],
		["耗时", withUnit(event.elapsedMs, "ms")],
		["超时", withUnit(event.timeoutMs, "ms")],
		["重试等待", withUnit(event.retryAfterMs, "ms")],
		["输入 token", event.inputTokens],
		["缓存读取 token", event.cacheReadTokens],
		["缓存写入 token", event.cacheWriteTokens],
		["非缓存 token", event.noCacheTokens],
		["输出 token", event.outputTokens],
		["计费字符", event.billedCharacters],
		["状态", event.status],
		["错误码", event.errorCode],
		["可重试", booleanText(event.retryable)],
		["已取消", booleanText(event.cancelled)],
		["标签页", event.tabId],
		["运行", event.runId],
		["请求", event.requestId],
	];
	return fields.flatMap(([label, value]) => {
		const text = scalarText(value);
		return text ? [{ label, value: text }] : [];
	});
}

function debugStatus(event) {
	if (typeof event.httpStatus === "number" && event.httpStatus >= 400) {
		return "error";
	}
	if (typeof event.errorCode === "string" && event.errorCode) {
		return "error";
	}
	if (event.status === "error" || event.status === "failed") {
		return "error";
	}
	return "ok";
}

export function createDebugRows(events) {
	return normalizeDebugEvents(events).map((event, index) => {
		const eventName = scalarText(event.eventType) || scalarText(event.operation) || "DEBUG_EVENT";
		const timestamp = shortText(event.timestamp, 80);
		let id = `event-${index}`;
		if (typeof event.seq === "number" && Number.isFinite(event.seq)) {
			id = `event-${event.seq}`;
		} else if (timestamp) {
			id = `event-${timestamp}-${index}`;
		}
		return {
			id,
			time: formatDebugTime(event.timestamp),
			dateTime: timestamp,
			name: eventName,
			status: debugStatus(event),
			fields: debugFields(event),
		};
	});
}

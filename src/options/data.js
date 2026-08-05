export const MODEL_PROVIDER_IDS = Object.freeze(["deepseek", "openai", "google", "anthropic"]);

const TOKEN_USAGE_PROVIDERS = new Set([...MODEL_PROVIDER_IDS, "custom"]);
export const DEBUG_EVENT_LIMIT = 300;
const DEBUG_EVENT_NAMES = Object.freeze({
	"debug.logging-enabled": "调试记录已开启",
	"settings.saved": "设置已保存",
	"run.started": "页面任务开始",
	"batch.received": "收到翻译批次",
	"cache.resolved": "缓存检查完成",
	"model.request.started": "模型请求开始",
	"sdk.request-start": "HTTP 请求发出",
	"sdk.request-end": "HTTP 响应返回",
	"sdk.request-error": "HTTP 连接失败",
	"model.request.completed": "模型响应完成",
	"model.request.failed": "模型请求失败",
	"model.request.retry-scheduled": "模型请求等待重试",
	"model.response.validated": "模型响应已校验",
	"request.started": "翻译 API 请求发出",
	"request.completed": "翻译 API 响应返回",
	"request.failed": "翻译 API 请求失败",
	"request.retry-scheduled": "翻译 API 等待重试",
	"request-start": "HTTP 请求发出",
	"request-end": "HTTP 响应返回",
	"request-error": "HTTP 连接失败",
	"provider.usage": "用量已记录",
	"batch.completed": "翻译批次完成",
	"batch.failed": "翻译批次失败",
});
const DEBUG_REQUEST_START_EVENTS = new Set([
	"sdk.request-start",
	"request.started",
	"request-start",
]);
const DEBUG_REQUEST_END_EVENTS = new Set([
	"sdk.request-end",
	"request.completed",
	"request-end",
]);
const DEBUG_REQUEST_ERROR_EVENTS = new Set([
	"sdk.request-error",
	"request.failed",
	"request-error",
]);

export const PROVIDERS = Object.freeze([
	Object.freeze({
		id: "deepseek",
		name: "DeepSeek",
		cue: "默认 · 低成本",
		note: "关闭思考模式，适合日常双语翻译。",
		kind: "model",
		recommended: true,
	}),
	Object.freeze({
		id: "openai",
		name: "OpenAI",
		cue: "稳定 · 高吞吐",
		note: "官方 API，响应稳定。",
		kind: "model",
		recommended: true,
	}),
	Object.freeze({
		id: "google",
		name: "Gemini",
		cue: "可用免费层",
		note: "配额以 Google 账号与区域政策为准。",
		kind: "model",
		recommended: true,
	}),
	Object.freeze({
		id: "anthropic",
		name: "Anthropic",
		cue: "高质量",
		note: "适合偏好 Claude 的场景。",
		kind: "model",
		recommended: false,
	}),
	Object.freeze({
		id: "azure",
		name: "Azure",
		cue: "机器翻译",
		note: "区域与 Azure 资源一致；全局资源可留空。",
		kind: "azure",
		recommended: false,
	}),
	Object.freeze({
		id: "deepl",
		name: "DeepL",
		cue: "机器翻译",
		note: "自动识别 Free（:fx）与 Pro 密钥。",
		kind: "deepl",
		recommended: false,
	}),
	Object.freeze({
		id: "custom",
		name: "自定义",
		cue: "OpenAI 兼容",
		note: "兼容 OpenAI Chat Completions 的代理或私有部署。",
		kind: "custom",
		recommended: false,
	}),
]);

export const TARGETS = Object.freeze([
	Object.freeze({
		id: "auto",
		name: "自动判断",
		cue: "中英互译",
	}),
	Object.freeze({
		id: "zh",
		name: "译为中文",
		cue: "英 → 中",
	}),
	Object.freeze({
		id: "en",
		name: "译为英文",
		cue: "中 → 英",
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

function formatCostPair(cost) {
	if (!isRecord(cost)) {
		return "";
	}
	if (!Number.isFinite(cost.input) && !Number.isFinite(cost.output)) {
		return "";
	}
	return `$${formatDecimal(cost.input)} / $${formatDecimal(cost.output)}`;
}

function formatContextSize(limits) {
	if (!isRecord(limits) || !Number.isFinite(limits.context)) {
		return "";
	}
	if (limits.context >= 1_000_000) {
		const millions = limits.context / 1_000_000;
		const text = Number.isInteger(millions) ? String(millions) : millions.toFixed(1);
		return `${text}M 上下文`;
	}
	if (limits.context >= 1_000) {
		return `${formatNumber(Math.round(limits.context / 1_000))}K 上下文`;
	}
	return `${formatNumber(limits.context)} 上下文`;
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
	const costText = formatCostPair(isRecord(value.cost) ? value.cost : {});
	const contextText = formatContextSize(isRecord(value.limits) ? value.limits : {});
	const chips = [costText, contextText].filter(Boolean);
	const label = chips.length > 0 ? `${name} · ${chips.join(" · ")}` : name;
	return {
		id,
		name,
		label,
		optionLabel: name,
		costText,
		contextText,
		chips,
	};
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
		custom: { apiKey: "", baseUrl: "", model: "" },
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
		["seq", "序号", event.seq],
		["extensionVersion", "扩展版本", event.extensionVersion],
		["catalogSourceSha", "目录 SHA", event.catalogSourceSha],
		["workerInstanceId", "Worker", event.workerInstanceId],
		["component", "组件", event.component],
		["operation", "操作", event.operation],
		["provider", "服务", event.provider],
		["providerAdapter", "Adapter", event.providerAdapter],
		["apiHost", "API Host", formatApiHost(event.apiHost)],
		["inferencePolicy", "推理策略", event.inferencePolicy],
		["model", "模型", event.model],
		["responseId", "响应 ID", event.responseId],
		["responseModel", "响应模型", event.responseModel],
		["finishReason", "结束原因", event.finishReason],
		["rawFinishReason", "原始结束原因", event.rawFinishReason],
		["warningCount", "警告数", event.warningCount],
		["language", "语言", languagePair(event.sourceLanguage, event.targetLanguage)],
		["method", "方法", event.method],
		["endpoint", "端点", formatEndpoint(event.endpoint)],
		["attempt", "尝试", event.attempt],
		["configuredConcurrency", "配置并发", event.configuredConcurrency],
		["batchIndex", "批次序号", event.batchIndex],
		["batchCount", "批次数", event.batchCount],
		["queueDepth", "队列深度", event.queueDepth],
		["segmentCount", "段落", event.segmentCount],
		["sourceCharacters", "原文字符", event.sourceCharacters],
		["cacheHits", "缓存命中", event.cacheHits],
		["cacheMisses", "缓存未命中", event.cacheMisses],
		["httpStatus", "HTTP", event.httpStatus],
		["elapsedMs", "耗时", withUnit(event.elapsedMs, "ms")],
		["timeoutMs", "超时", withUnit(event.timeoutMs, "ms")],
		["retryAfterMs", "重试等待", withUnit(event.retryAfterMs, "ms")],
		["inputTokens", "输入 token", event.inputTokens],
		["cacheReadTokens", "缓存读取 token", event.cacheReadTokens],
		["cacheWriteTokens", "缓存写入 token", event.cacheWriteTokens],
		["noCacheTokens", "非缓存 token", event.noCacheTokens],
		["outputTokens", "输出 token", event.outputTokens],
		["billedCharacters", "计费字符", event.billedCharacters],
		["status", "状态", event.status],
		["errorCode", "错误码", event.errorCode],
		["retryable", "可重试", booleanText(event.retryable)],
		["cancelled", "已取消", booleanText(event.cancelled)],
		["tabId", "标签页", event.tabId],
		["runId", "运行", event.runId],
		["requestId", "请求", event.requestId],
	];
	return fields.flatMap(([key, label, value]) => {
		const text = scalarText(value);
		return text ? [{ key, label, value: text }] : [];
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
	if (event.status === "started" || event.status === "waiting") {
		return "pending";
	}
	return "ok";
}

function debugSummary(event, eventName) {
	const endpoint = formatEndpoint(event.endpoint);
	if (endpoint) {
		return [
			scalarText(event.method),
			endpoint,
			typeof event.httpStatus === "number" ? `HTTP ${event.httpStatus}` : "",
			withUnit(event.elapsedMs, "ms"),
		]
			.filter(Boolean)
			.join(" · ");
	}
	if (eventName === "cache.resolved") {
		return `命中 ${formatNumber(event.cacheHits)} · 未命中 ${formatNumber(event.cacheMisses)}`;
	}
	return [
		scalarText(event.provider),
		scalarText(event.model),
		languagePair(event.sourceLanguage, event.targetLanguage),
		typeof event.segmentCount === "number" ? `${formatNumber(event.segmentCount)} 段` : "",
		typeof event.sourceCharacters === "number"
			? `${formatNumber(event.sourceCharacters)} 字符`
			: "",
		withUnit(event.elapsedMs, "ms"),
	]
		.filter(Boolean)
		.join(" · ");
}

function createDebugSearchText(row) {
	return [
		row.name,
		row.code,
		row.summary,
		row.badge,
		...row.fields.flatMap((field) => [field.label, field.value]),
	]
		.join(" ")
		.toLowerCase();
}

export function createDebugRows(events) {
	return normalizeDebugEvents(events).map((event, index) => {
		const eventName = scalarText(event.eventType) || scalarText(event.operation) || "DEBUG_EVENT";
		const timestamp = shortText(event.timestamp, 80);
		const status = debugStatus(event);
		let id = `event-${index}`;
		if (typeof event.seq === "number" && Number.isFinite(event.seq)) {
			id = `event-${event.seq}`;
		} else if (timestamp) {
			id = `event-${timestamp}-${index}`;
		}
		const row = {
			id,
			time: formatDebugTime(event.timestamp),
			dateTime: timestamp,
			name: DEBUG_EVENT_NAMES[eventName] || eventName,
			code: eventName,
			summary: debugSummary(event, eventName),
			badge:
				status === "error"
					? "错误"
					: status === "pending"
						? "进行中"
						: scalarText(event.component) || "完成",
			status,
			fields: debugFields(event),
		};
		return { ...row, searchText: createDebugSearchText(row) };
	});
}

export function createDebugRequests(events) {
	const requests = new Map();
	for (const [index, event] of normalizeDebugEvents(events).entries()) {
		const eventName = scalarText(event.eventType) || scalarText(event.operation);
		const started = DEBUG_REQUEST_START_EVENTS.has(eventName);
		const completed = DEBUG_REQUEST_END_EVENTS.has(eventName);
		const failed = DEBUG_REQUEST_ERROR_EVENTS.has(eventName);
		if (!started && !completed && !failed) {
			continue;
		}
		const requestId = shortText(event.requestId, 300);
		const attempt =
			typeof event.attempt === "number" && Number.isFinite(event.attempt)
				? Math.max(0, Math.round(event.attempt))
				: 0;
		const key = requestId ? `${requestId}:${attempt}` : `request-event-${index}`;
		const previous = requests.get(key);
		const eventNames = previous ? [...previous.eventNames, eventName] : [eventName];
		const mergedEvent = { ...(previous?.event || {}), ...event };
		let status = previous?.status || "pending";
		if (failed || debugStatus(event) === "error") {
			status = "error";
		} else if (completed) {
			status = "ok";
		}
		requests.set(key, {
			id: `request-${key}`,
			dateTime: previous?.dateTime || shortText(event.timestamp, 80),
			event: mergedEvent,
			eventNames,
			status,
		});
	}

	return [...requests.values()].map((request) => {
		const endpoint = formatEndpoint(request.event.endpoint);
		const endpointParts = urlParts(endpoint);
		const method = scalarText(request.event.method);
		const host = endpointParts?.host || formatApiHost(request.event.apiHost);
		const fields = debugFields(request.event);
		const httpStatus =
			typeof request.event.httpStatus === "number" ? request.event.httpStatus : undefined;
		const badge =
			httpStatus !== undefined
				? `HTTP ${httpStatus}`
				: scalarText(request.event.errorCode) ||
					(request.status === "pending" ? "等待响应" : "完成");
		const row = {
			id: request.id,
			time: formatDebugTime(request.dateTime),
			dateTime: request.dateTime,
			name: [method, host].filter(Boolean).join(" ") || "Provider 请求",
			code: request.eventNames.join(" → "),
			summary: [
				endpointParts?.path || endpoint,
				[scalarText(request.event.provider), scalarText(request.event.model)]
					.filter(Boolean)
					.join(" / "),
				withUnit(request.event.elapsedMs, "ms"),
			]
				.filter(Boolean)
				.join(" · "),
			badge,
			status: request.status,
			fields,
		};
		return { ...row, searchText: createDebugSearchText(row) };
	});
}

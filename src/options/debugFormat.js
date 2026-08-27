import { isRecord, safeString } from "../core/value-utils.js";
import { DEBUG_EVENT_LIMIT } from "./debugConstants.js";
import { formatNumber } from "./formatters.js";

export function normalizeDebugEvents(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((event) => isRecord(event)).slice(-DEBUG_EVENT_LIMIT);
}

export function scalarText(value) {
	if (typeof value === "number" && Number.isFinite(value)) {
		return formatNumber(value);
	}
	return safeString(value, "", 160);
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

export function urlParts(value) {
	const input = safeString(value, "", 2_048);
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
	const input = safeString(value, "", 2_048);
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

export function formatDebugTime(value) {
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

export function withUnit(value, unit) {
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

function formatRequestPayload(value) {
	if (!isRecord(value)) {
		return "";
	}
	const payload = {};
	if (typeof value.model === "string" && value.model) {
		payload.model = value.model.slice(0, 300);
	}
	if (typeof value.max_tokens === "number" && Number.isFinite(value.max_tokens)) {
		payload.max_tokens = Math.max(0, Math.round(value.max_tokens));
	}
	if (isRecord(value.thinking) && typeof value.thinking.type === "string") {
		payload.thinking = { type: value.thinking.type.slice(0, 100) };
	}
	if (Array.isArray(value.messages)) {
		payload.messages = value.messages.slice(0, 32).flatMap((message) => {
			if (
				!isRecord(message) ||
				typeof message.role !== "string" ||
				typeof message.content !== "string"
			) {
				return [];
			}
			return [{ role: message.role.slice(0, 50), content: message.content.slice(0, 32_768) }];
		});
	}
	return Object.keys(payload).length > 0 ? JSON.stringify(payload, null, 2).slice(0, 40_000) : "";
}

export function debugFields(event) {
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
		["requestPayload", "DeepSeek 请求正文", formatRequestPayload(event.requestPayload), true],
		["requestPayloadTruncated", "请求正文已截断", booleanText(event.requestPayloadTruncated)],
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
	return fields.flatMap(([key, label, value, multiline]) => {
		const text = multiline ? value : scalarText(value);
		return text ? [{ key, label, value: text, ...(multiline ? { multiline: true } : {}) }] : [];
	});
}

export function debugStatus(event) {
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

export function debugSummary(event, eventName) {
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

export function createDebugSearchText(row) {
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

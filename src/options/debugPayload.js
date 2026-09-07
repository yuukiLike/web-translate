import {
	createSafeRequestPayload,
	normalizeOmittedFields,
} from "../../chrome-extension/background/request-payload-sanitizer.js";
import { isRecord } from "../core/value-utils.js";

/** Project only captured HTTP data. Metadata and prompt templates never fill missing bodies. */
export function createRequestCapture(event) {
	const source = isRecord(event) ? event : {};
	const safe = createSafeRequestPayload(source.requestPayload);
	const omittedFields = normalizeOmittedFields([
		...(safe?.omittedFields ?? []),
		...normalizeOmittedFields(source.requestPayloadOmittedFields),
	]);
	const payload = safe?.payload ?? null;
	const truncated = safe?.truncated === true || source.requestPayloadTruncated === true;
	return {
		payload,
		truncated,
		omittedFields,
		status: !payload ? "missing" : truncated || omittedFields.length ? "partial" : "complete",
	};
}

function translationContent(value) {
	if (!isRecord(value) || !Array.isArray(value.segments)) return null;
	const validSegments = value.segments.every(
		(segment) => isRecord(segment) && typeof segment.id === "string" && typeof segment.text === "string",
	);
	if (!validSegments) return null;
	return {
		sourceLanguage: typeof value.source_language === "string" ? value.source_language : "未提供",
		targetLanguage: typeof value.target_language === "string" ? value.target_language : "未提供",
		segments: value.segments.map(({ id, text }) => ({ id, text })),
	};
}

export function parseMessageContent(content) {
	if (typeof content !== "string") return { format: "text", value: "", translation: null };
	try {
		const value = JSON.parse(content);
		return { format: "json", value, translation: translationContent(value) };
	} catch {
		return { format: "text", value: content, translation: null };
	}
}

export function createMessageViews(payload) {
	if (!Array.isArray(payload?.messages)) return [];
	return payload.messages.map((message, index) => ({
		index,
		role: message.role,
		content: message.content,
		parsed: parseMessageContent(message.content),
	}));
}

export function requestParameters(payload) {
	if (!isRecord(payload)) return {};
	return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "messages"));
}

export function formatDebugJson(value) {
	try {
		return JSON.stringify(value, null, 2) ?? "null";
	} catch {
		return "无法格式化这份数据";
	}
}

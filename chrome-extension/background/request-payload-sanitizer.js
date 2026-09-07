import { DEBUG_LIMITS } from "./constants.js";
import { estimateStorageBytes } from "./utilities.js";

const KNOWN_FIELDS = new Set([
	"model", "max_tokens", "thinking", "messages", "role", "content", "type",
	"temperature", "top_p", "frequency_penalty", "presence_penalty", "stop", "stream",
	"response_format", "reasoning_effort", "json_schema", "schema", "strict", "name",
	"description", "tools", "tool_choice", "tool_calls", "tool_call_id", "budget",
	"reasoning_content", "stream_options", "include_usage", "other_field",
]);

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequestPayload(value) {
	if (isRecord(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function contentPrefixThatFits(payload, role, content) {
	let minimum = 0;
	let maximum = content.length;
	while (minimum < maximum) {
		const middle = Math.ceil((minimum + maximum) / 2);
		const candidate = {
			...payload,
			messages: [...payload.messages, { role, content: content.slice(0, middle) }],
		};
		if (estimateStorageBytes(candidate) <= DEBUG_LIMITS.maxRequestPayloadBytes) {
			minimum = middle;
		} else {
			maximum = middle - 1;
		}
	}
	return content.slice(0, minimum);
}

export function createSafeRequestPayload(value) {
	const source = parseRequestPayload(value);
	if (!source) {
		return undefined;
	}
	const payload = {};
	let truncated = false;
	const omittedFields = new Set();
	if (typeof source.model === "string" && source.model) {
		payload.model = source.model.slice(0, 300);
		truncated ||= payload.model.length < source.model.length;
	}
	if (typeof source.max_tokens === "number" && Number.isFinite(source.max_tokens)) {
		payload.max_tokens = Math.max(0, Math.round(source.max_tokens));
		truncated ||= payload.max_tokens !== source.max_tokens;
	}
	if (isRecord(source.thinking) && typeof source.thinking.type === "string") {
		payload.thinking = { type: source.thinking.type.slice(0, 100) };
		truncated ||= payload.thinking.type.length < source.thinking.type.length;
	}
	for (const field of ["temperature", "top_p", "frequency_penalty", "presence_penalty"]) {
		if (typeof source[field] === "number" && Number.isFinite(source[field])) payload[field] = source[field];
	}
	if (typeof source.reasoning_effort === "string") {
		payload.reasoning_effort = source.reasoning_effort.slice(0, 100);
		truncated ||= payload.reasoning_effort !== source.reasoning_effort;
	}
	if (typeof source.stream === "boolean") payload.stream = source.stream;
	if (isRecord(source.response_format) && ["text", "json_object"].includes(source.response_format.type)) {
		payload.response_format = { type: source.response_format.type };
	}
	if (Array.isArray(source.stop)) {
		payload.stop = source.stop.slice(0, 32).filter((value) => typeof value === "string").map((value) => value.slice(0, 300));
		truncated ||= JSON.stringify(payload.stop) !== JSON.stringify(source.stop);
	}
	for (const field of Object.keys(source)) {
		if (field === "messages") continue;
		if (!Object.hasOwn(payload, field)) omittedFields.add(safeFieldName(field));
	}
	for (const parent of ["thinking", "response_format"]) {
		if (!isRecord(source[parent])) continue;
		for (const field of Object.keys(source[parent])) {
			if (field !== "type") omittedFields.add(`${parent}.${safeFieldName(field)}`);
		}
	}
	const sourceMessages = Array.isArray(source.messages) ? source.messages : [];
	if (Object.hasOwn(source, "messages") && !Array.isArray(source.messages)) omittedFields.add("messages");
	if (Array.isArray(source.messages) && source.messages.length === 0) payload.messages = [];
	for (const message of sourceMessages.slice(0, DEBUG_LIMITS.maxRequestMessages)) {
		if (!isRecord(message)) continue;
		for (const field of Object.keys(message)) {
			if (!["role", "content"].includes(field)) omittedFields.add(`messages.${safeFieldName(field)}`);
		}
	}

	const messages = sourceMessages
		.slice(0, DEBUG_LIMITS.maxRequestMessages + 1)
		.filter(
			(message) =>
				isRecord(message) &&
				typeof message.role === "string" &&
				typeof message.content === "string",
		);
	truncated ||= messages.length !== sourceMessages.length;
	if (messages.length > 0) {
		payload.messages = [];
		const limitedMessages = messages.slice(0, DEBUG_LIMITS.maxRequestMessages);
		truncated ||=
			limitedMessages.length < messages.length ||
			sourceMessages.length > DEBUG_LIMITS.maxRequestMessages;
		for (const message of limitedMessages) {
			const role = message.role.slice(0, 50);
			truncated ||= role.length < message.role.length;
			const completeMessage = { role, content: message.content };
			const candidate = { ...payload, messages: [...payload.messages, completeMessage] };
			if (estimateStorageBytes(candidate) <= DEBUG_LIMITS.maxRequestPayloadBytes) {
				payload.messages.push(completeMessage);
				continue;
			}
			const content = contentPrefixThatFits(payload, role, message.content);
			const shortenedMessage = { role, content };
			const shortenedPayload = {
				...payload,
				messages: [...payload.messages, shortenedMessage],
			};
			if (estimateStorageBytes(shortenedPayload) <= DEBUG_LIMITS.maxRequestPayloadBytes) {
				payload.messages.push(shortenedMessage);
			}
			truncated = true;
			break;
		}
	}
	if (Object.keys(payload).length === 0) {
		return undefined;
	}
	return { payload, truncated, omittedFields: normalizeOmittedFields([...omittedFields]) };
}

function safeFieldName(value) {
	return KNOWN_FIELDS.has(value) ? value : "other_field";
}

export function normalizeOmittedFields(value) {
	if (!Array.isArray(value)) return [];
	const names = value.slice(0, 64)
		.filter((field) => typeof field === "string")
		.map((field) => field.split(".").slice(0, 4).map(safeFieldName).join("."));
	return [...new Set(names)];
}

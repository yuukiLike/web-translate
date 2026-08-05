import { DEBUG_LIMITS } from "./constants.js";
import { estimateStorageBytes } from "./utilities.js";

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
	if (typeof source.model === "string" && source.model) {
		payload.model = source.model.slice(0, 300);
		truncated ||= payload.model.length < source.model.length;
	}
	if (typeof source.max_tokens === "number" && Number.isFinite(source.max_tokens)) {
		payload.max_tokens = Math.max(0, Math.round(source.max_tokens));
	}
	if (isRecord(source.thinking) && typeof source.thinking.type === "string") {
		payload.thinking = { type: source.thinking.type.slice(0, 100) };
		truncated ||= payload.thinking.type.length < source.thinking.type.length;
	}
	const sourceMessages = Array.isArray(source.messages) ? source.messages : [];
	const messages = sourceMessages
		.slice(0, DEBUG_LIMITS.maxRequestMessages + 1)
		.filter(
			(message) =>
				isRecord(message) &&
				typeof message.role === "string" &&
				typeof message.content === "string",
		);
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
	return { payload, truncated };
}

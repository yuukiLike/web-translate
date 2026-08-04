import { MODEL_PROVIDERS } from "../generated/provider-catalog.ts";
import { isProviderId, isRecord } from "./core.ts";
import type { DebugEvent, Language } from "./types.ts";

export const DEBUG_EVENTS_MAX_COUNT = 300;
export const DEBUG_EVENTS_MAX_BYTES = 512 * 1_024;

const MAXIMUM_STORED_JSON_LENGTH = 1_024 * 1_024;
const ALLOWED_MODEL_IDS = new Set<string>(
	MODEL_PROVIDERS.map((provider) => provider.defaultModelId),
);
const ALLOWED_EVENT_TYPES = new Set([
	"cache.failed",
	"provider.attempt.completed",
	"provider.attempt.failed",
	"provider.attempt.started",
	"provider.retry.scheduled",
	"request.completed",
	"request.failed",
	"request.started",
	"translation.completed",
	"translation.failed",
	"translation.started",
]);
const ALLOWED_STATUSES = new Set(["cancelled", "completed", "failed", "started", "waiting"]);
const ALLOWED_ERROR_CODES = new Set([
	"CACHE_READ_FAILED",
	"CACHE_WRITE_FAILED",
	"FETCH_UNAVAILABLE",
	"INCOMPLETE_RESPONSE",
	"INVALID_JSON",
	"INVALID_RESPONSE",
	"NETWORK_ERROR",
	"OUTPUT_LIMIT",
	"PROVIDER_UNAVAILABLE",
	"REQUEST_CANCELLED",
	"REQUEST_FAILED",
	"REQUEST_TIMEOUT",
	"RESPONSE_TOO_LARGE",
	"RETRY_AFTER_TOO_LONG",
	"TRANSLATION_FAILED",
	"UNSUPPORTED_PROVIDER",
]);
const SAFE_ENDPOINTS = new Set([
	"https://api.cognitive.microsofttranslator.com/translate",
	"https://api-free.deepl.com/v2/translate",
	"https://api.deepl.com/v2/translate",
	...MODEL_PROVIDERS.map((provider) => {
		switch (provider.id) {
			case "deepseek":
				return `${provider.apiBaseURL}/chat/completions`;
			case "openai":
				return `${provider.apiBaseURL}/responses`;
			case "google":
				return `${provider.apiBaseURL}/models/${provider.defaultModelId}:generateContent`;
			case "anthropic":
				return `${provider.apiBaseURL}/messages`;
		}
	}),
]);
const NUMBER_FIELDS = [
	"attempt",
	"httpStatus",
	"elapsedMs",
	"timeoutMs",
	"retryAfterMs",
	"sourceCharacters",
	"outputCharacters",
	"inputTokens",
	"outputTokens",
	"cacheReadTokens",
	"billedCharacters",
] as const;
const BOOLEAN_FIELDS = ["retryable", "cacheHit"] as const;

type DebugNumberField = (typeof NUMBER_FIELDS)[number];
type DebugBooleanField = (typeof BOOLEAN_FIELDS)[number];

export function sanitizeDebugEvent(input: unknown, now: Date = new Date()): DebugEvent {
	const value = isRecord(input) ? input : {};
	const event: DebugEvent = {
		id: sanitizeIdentifier(value.id) || createIdentifier(),
		timestamp: sanitizeTimestamp(value.timestamp) || now.toISOString(),
		eventType: sanitizeEventName(value.eventType) || "unknown",
	};
	if (isProviderId(value.provider)) {
		event.provider = value.provider;
	}
	if (typeof value.modelId === "string" && ALLOWED_MODEL_IDS.has(value.modelId)) {
		event.modelId = value.modelId;
	}
	const sourceLanguage = sanitizeLanguage(value.sourceLanguage);
	const targetLanguage = sanitizeLanguage(value.targetLanguage);
	if (sourceLanguage) {
		event.sourceLanguage = sourceLanguage;
	}
	if (targetLanguage) {
		event.targetLanguage = targetLanguage;
	}
	if (typeof value.status === "string" && ALLOWED_STATUSES.has(value.status)) {
		event.status = value.status;
	}
	if (
		typeof value.errorCode === "string" &&
		(ALLOWED_ERROR_CODES.has(value.errorCode) || /^HTTP_[1-5][0-9]{2}$/u.test(value.errorCode))
	) {
		event.errorCode = value.errorCode;
	}
	const requestId = sanitizeIdentifier(value.requestId);
	if (requestId) {
		event.requestId = requestId;
	}
	const endpoint = sanitizeEndpoint(value.endpoint);
	if (endpoint) {
		event.endpoint = endpoint;
	}
	for (const field of NUMBER_FIELDS) {
		const number = sanitizeNumber(value[field]);
		if (number !== undefined) {
			setNumberField(event, field, number);
		}
	}
	for (const field of BOOLEAN_FIELDS) {
		if (typeof value[field] === "boolean") {
			setBooleanField(event, field, value[field]);
		}
	}
	return event;
}

function setNumberField(event: DebugEvent, field: DebugNumberField, value: number): void {
	event[field] = value;
}

function setBooleanField(event: DebugEvent, field: DebugBooleanField, value: boolean): void {
	event[field] = value;
}

function sanitizeIdentifier(value: unknown): string {
	return typeof value === "string" &&
		(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value) ||
			/^generated-[a-z0-9]+-[a-z0-9]+$/u.test(value))
		? value
		: "";
}

function sanitizeTimestamp(value: unknown): string {
	if (typeof value !== "string" || value.length > 80) {
		return "";
	}
	const timestamp = new Date(value);
	return Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
}

function sanitizeEventName(value: unknown): string {
	return typeof value === "string" && ALLOWED_EVENT_TYPES.has(value) ? value : "";
}

function sanitizeLanguage(value: unknown): Language | undefined {
	return value === "en" || value === "zh" ? value : undefined;
}

function sanitizeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.round(value))
		: undefined;
}

export function sanitizeEndpoint(value: unknown): string | undefined {
	if (typeof value !== "string" && !(value instanceof URL)) {
		return undefined;
	}
	try {
		const url = new URL(String(value));
		const endpoint = `${url.origin}${url.pathname}`;
		return SAFE_ENDPOINTS.has(endpoint) ? endpoint : undefined;
	} catch {
		return undefined;
	}
}

function createIdentifier(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `generated-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function parseStoredDebugEvents(value: unknown): DebugEvent[] {
	if (typeof value !== "string" || value.length > MAXIMUM_STORED_JSON_LENGTH) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.slice(-DEBUG_EVENTS_MAX_COUNT).map((event) => sanitizeDebugEvent(event))
			: [];
	} catch {
		return [];
	}
}

export function trimDebugEvents(events: DebugEvent[]): DebugEvent[] {
	const trimmed = events.slice(-DEBUG_EVENTS_MAX_COUNT);
	while (
		trimmed.length > 1 &&
		new TextEncoder().encode(JSON.stringify(trimmed)).byteLength > DEBUG_EVENTS_MAX_BYTES
	) {
		trimmed.shift();
	}
	return trimmed;
}

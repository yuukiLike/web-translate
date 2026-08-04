import assert from "node:assert/strict";
import test from "node:test";

import {
	DEBUG_EVENTS_MAX_COUNT,
	parseStoredDebugEvents,
	sanitizeDebugEvent,
	trimDebugEvents,
} from "../src/lib/debug-core.ts";

test("keeps only allowlisted scalar diagnostics and strips endpoint secrets", () => {
	const apiKey = "sk-never-store-this-key";
	const sourceText = "private source text";
	const translatedText = "private translated text";
	const rawError = "provider raw error body";
	const event = sanitizeDebugEvent(
		{
			id: "request-1",
			timestamp: "2026-08-04T00:00:00.000Z",
			eventType: "request.completed",
			provider: "deepseek",
			modelId: apiKey,
			endpoint: `https://api.deepseek.com/chat/completions?api_key=${apiKey}`,
			status: "completed",
			httpStatus: 200,
			apiKey,
			text: sourceText,
			translation: translatedText,
			headers: { Authorization: apiKey },
			body: sourceText,
			error: new Error(rawError),
			rawError,
		},
		new Date("2026-08-04T00:00:00.000Z"),
	);
	const serialized = JSON.stringify(event);

	assert.equal(event.endpoint, "https://api.deepseek.com/chat/completions");
	assert.equal(event.modelId, undefined);
	assert.equal(event.httpStatus, 200);
	for (const secret of [apiKey, sourceText, translatedText, rawError, "Authorization"]) {
		assert.equal(serialized.includes(secret), false);
	}
	for (const forbiddenField of [
		"apiKey",
		"text",
		"translation",
		"headers",
		"body",
		"error",
		"rawError",
	]) {
		assert.equal(Object.hasOwn(event, forbiddenField), false);
	}
});

test("retains only model ids from the generated allowlist", () => {
	assert.equal(
		sanitizeDebugEvent({ eventType: "model.completed", modelId: "gpt-5.6-luna" }).modelId,
		"gpt-5.6-luna",
	);
	assert.equal(
		sanitizeDebugEvent({ eventType: "model.completed", modelId: "sk-secret-looking" }).modelId,
		undefined,
	);
	const secretShapedFields = sanitizeDebugEvent({
		eventType: "sk-secret-looking",
		requestId: "sk-secret-looking",
		errorCode: "SK_SECRET_LOOKING",
		endpoint: "https://api.deepseek.com/sk-secret-looking",
	});
	assert.equal(secretShapedFields.eventType, "unknown");
	assert.equal(secretShapedFields.requestId, undefined);
	assert.equal(secretShapedFields.errorCode, undefined);
	assert.equal(secretShapedFields.endpoint, undefined);
});

test("re-sanitizes stored events and bounds their count", () => {
	const stored = JSON.stringify([
		{
			eventType: "request.failed",
			provider: "openai",
			apiKey: "secret",
			body: "private text",
			errorCode: "HTTP_503",
		},
	]);
	const events = parseStoredDebugEvents(stored);

	assert.equal(events.length, 1);
	assert.equal(events[0]?.errorCode, "HTTP_503");
	assert.equal(JSON.stringify(events).includes("secret"), false);
	assert.equal(
		trimDebugEvents(
			Array.from({ length: DEBUG_EVENTS_MAX_COUNT + 5 }, (_, index) =>
				sanitizeDebugEvent({ id: `event-${index}`, eventType: "request.completed" }),
			),
		).length,
		DEBUG_EVENTS_MAX_COUNT,
	);
});

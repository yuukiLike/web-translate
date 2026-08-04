import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderId } from "../src/generated/provider-catalog.ts";
import { isRecord, normalizePreferences } from "../src/lib/core.ts";
import {
	MODEL_MAXIMUM_OUTPUT_TOKENS,
	ProviderRequestError,
	isRetryableHttpStatus,
	parseRetryAfter,
	translateWithProvider,
} from "../src/lib/providers.ts";
import type { TranslationPreferences } from "../src/lib/types.ts";

interface RecordedRequest {
	url: string;
	init: RequestInit | undefined;
}

function preferencesFor(
	provider: ProviderId,
	apiKey = "provider-secret-key",
): TranslationPreferences {
	switch (provider) {
		case "azure":
			return normalizePreferences({ provider, azureApiKey: apiKey, azureRegion: "eastasia" });
		case "deepl":
			return normalizePreferences({ provider, deeplApiKey: apiKey });
		case "deepseek":
			return normalizePreferences({ provider, deepseekApiKey: apiKey });
		case "openai":
			return normalizePreferences({ provider, openaiApiKey: apiKey });
		case "google":
			return normalizePreferences({ provider, googleApiKey: apiKey });
		case "anthropic":
			return normalizePreferences({ provider, anthropicApiKey: apiKey });
	}
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string" || input instanceof URL) {
		return String(input);
	}
	return input.url;
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function parseRequestBody(request: RecordedRequest): Record<string, unknown> {
	const body = request.init?.body;
	if (typeof body !== "string") {
		throw new Error("Expected a JSON request body");
	}
	const parsed: unknown = JSON.parse(body);
	assert.ok(isRecord(parsed));
	return parsed;
}

function requireRecord(value: unknown): Record<string, unknown> {
	assert.ok(isRecord(value));
	return value;
}

test("classifies safe retry statuses, including DeepL overload", () => {
	for (const status of [408, 409, 425, 429, 500, 502, 503, 504, 529]) {
		assert.equal(isRetryableHttpStatus(status), true);
	}
	for (const status of [400, 401, 413, 456, 501]) {
		assert.equal(isRetryableHttpStatus(status), false);
	}
	assert.equal(parseRetryAfter("2"), 2_000);
	assert.equal(parseRetryAfter("invalid"), undefined);
	assert.equal(MODEL_MAXIMUM_OUTPUT_TOKENS, 48_000);
});

test("Azure sends the official request shape and validates its result", async () => {
	const requests: RecordedRequest[] = [];
	const fetchMock: typeof fetch = async (input, init) => {
		requests.push({ url: requestUrl(input), init });
		return jsonResponse([{ translations: [{ text: "你好" }] }]);
	};
	const result = await translateWithProvider(
		{
			preferences: preferencesFor("azure"),
			sourceText: "hello",
			sourceLanguage: "en",
			targetLanguage: "zh",
		},
		{ fetch: fetchMock },
	);

	assert.equal(result.translatedText, "你好");
	assert.deepEqual(result.usage, { billedCharacters: 5 });
	assert.match(requests[0]?.url ?? "", /api\.cognitive\.microsofttranslator\.com\/translate/u);
	assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), [{ Text: "hello" }]);
	assert.equal(
		new Headers(requests[0]?.init?.headers).get("Ocp-Apim-Subscription-Region"),
		"eastasia",
	);
});

test("DeepL retries HTTP 529 without persisting secrets in diagnostics", async () => {
	const apiKey = "deepl-private-key:fx";
	const sourceText = "private source";
	const events: unknown[] = [];
	const delays: number[] = [];
	const requests: RecordedRequest[] = [];
	const fetchMock: typeof fetch = async (input, init) => {
		requests.push({ url: requestUrl(input), init });
		return requests.length === 1
			? jsonResponse({ message: "overloaded" }, 529, { "retry-after": "0" })
			: jsonResponse({ translations: [{ text: "私密原文", billed_characters: 14 }] });
	};
	const result = await translateWithProvider(
		{
			preferences: preferencesFor("deepl", apiKey),
			sourceText,
			sourceLanguage: "en",
			targetLanguage: "zh",
			onEvent(event) {
				events.push(event);
			},
		},
		{
			fetch: fetchMock,
			random: () => 0,
			sleep: async (milliseconds) => {
				delays.push(milliseconds);
			},
		},
	);

	assert.equal(result.translatedText, "私密原文");
	assert.deepEqual(result.usage, { billedCharacters: 14 });
	assert.equal(requests.length, 2);
	assert.match(requests[0]?.url ?? "", /^https:\/\/api-free\.deepl\.com\/v2\/translate$/u);
	assert.deepEqual(delays, [600]);
	const serializedEvents = JSON.stringify(events);
	assert.equal(serializedEvents.includes(apiKey), false);
	assert.equal(serializedEvents.includes(sourceText), false);
	assert.equal(serializedEvents.includes("Authorization"), false);
});

test("reports actionable non-retryable DeepL 413 and 456 errors", async () => {
	for (const [status, message] of [
		[413, /文本过长/u],
		[456, /配额已用尽/u],
	] as const) {
		const fetchMock: typeof fetch = async () => jsonResponse({}, status);
		await assert.rejects(
			translateWithProvider(
				{
					preferences: preferencesFor("deepl"),
					sourceText: "hello",
					sourceLanguage: "en",
					targetLanguage: "zh",
				},
				{ fetch: fetchMock },
			),
			(error: unknown) =>
				error instanceof ProviderRequestError &&
				error.status === status &&
				message.test(error.message) &&
				error.retryable === false,
		);
	}
});

test("explicit model SDKs apply low-reasoning settings and parse strict JSON", async () => {
	const cases = [
		{
			provider: "deepseek" as const,
			response: {
				id: "response-deepseek",
				created: 1,
				model: "deepseek-v4-flash",
				choices: [
					{
						message: {
							role: "assistant",
							content: '{"translations":[{"id":"translation","text":"你好"}]}',
						},
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
			},
			assertBody(body: Record<string, unknown>) {
				assert.deepEqual(body.thinking, { type: "disabled" });
			},
		},
		{
			provider: "openai" as const,
			response: {
				id: "response-openai",
				created_at: 1,
				model: "gpt-5.6-luna",
				output: [
					{
						type: "message",
						role: "assistant",
						id: "message-openai",
						content: [
							{
								type: "output_text",
								text: '{"translations":[{"id":"translation","text":"你好"}]}',
								annotations: [],
							},
						],
					},
				],
				usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
			},
			assertBody(body: Record<string, unknown>) {
				assert.deepEqual(body.reasoning, { effort: "none" });
			},
		},
		{
			provider: "google" as const,
			response: {
				candidates: [
					{
						content: {
							parts: [
								{
									text: '{"translations":[{"id":"translation","text":"你好"}]}',
								},
							],
						},
						finishReason: "STOP",
					},
				],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
			},
			assertBody(body: Record<string, unknown>) {
				const generationConfig = requireRecord(body.generationConfig);
				assert.deepEqual(generationConfig.thinkingConfig, {
					includeThoughts: false,
					thinkingLevel: "minimal",
				});
			},
		},
		{
			provider: "anthropic" as const,
			response: {
				type: "message",
				id: "response-anthropic",
				model: "claude-sonnet-5",
				content: [
					{
						type: "text",
						text: '{"translations":[{"id":"translation","text":"你好"}]}',
					},
				],
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 3 },
			},
			assertBody(body: Record<string, unknown>) {
				assert.deepEqual(body.thinking, { type: "disabled" });
			},
		},
	];

	for (const providerCase of cases) {
		const requests: RecordedRequest[] = [];
		const fetchMock: typeof fetch = async (input, init) => {
			requests.push({ url: requestUrl(input), init });
			return jsonResponse(providerCase.response);
		};
		let result;
		try {
			result = await translateWithProvider(
				{
					preferences: preferencesFor(providerCase.provider),
					sourceText: "hello",
					sourceLanguage: "en",
					targetLanguage: "zh",
				},
				{ fetch: fetchMock },
			);
		} catch (error) {
			throw new Error(`${providerCase.provider} model request failed`, { cause: error });
		}

		assert.equal(result.translatedText, "你好", providerCase.provider);
		assert.equal(requests.length, 1, providerCase.provider);
		providerCase.assertBody(parseRequestBody(requests[0]));
	}
});

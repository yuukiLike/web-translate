import assert from "node:assert/strict";
import test from "node:test";

import { createModelTranslator } from "../../chrome-extension/background/providers/model-translator.js";
import {
	backgroundCore,
	createConfiguredSettings,
} from "../helpers/background-harness.mjs";

function createTranslator(generateTranslation) {
	const debugEvents = [];
	return {
		debugEvents,
		translator: createModelTranslator({
			core: backgroundCore,
			providerRuntime: { generateTranslation },
			debug: {
				getSafeEndpoint: (endpoint) => endpoint,
				recordRequest: (_context, event) => debugEvents.push(structuredClone(event)),
			},
			debugMetadata: {
				createRequestContext: () => ({}),
			},
		}),
	};
}

function successfulResult(request, usage = { inputTokens: 10, outputTokens: 5 }) {
	const payload = JSON.parse(request.messages[0].content);
	return {
		text: JSON.stringify({
			translations: payload.segments.map((segment) => ({
				id: segment.id,
				text: `译文：${segment.text}`,
			})),
		}),
		finishReason: "stop",
		usage,
	};
}

async function translate(translator, segments, settings = createConfiguredSettings()) {
	return await translator.translate(
		settings,
		"en",
		"zh",
		segments,
		new AbortController().signal,
	);
}

// 验证官方模型的输出预算不再被旧的 8192 token 常量截断，并为 JSON 包装保留余量。
test("模型批次获得超过旧上限的输出预算", async () => {
	const requests = [];
	const { translator } = createTranslator(async (request) => {
		requests.push(request);
		return successfulResult(request);
	});

	await translate(translator, [
		{ id: "first", text: "a".repeat(3_000) },
		{ id: "second", text: "b".repeat(3_000) },
	]);

	assert.equal(requests.length, 1);
	assert.ok(requests[0].maxOutputTokens > 8_192);
	assert.ok(requests[0].maxOutputTokens <= 16_384);
});

// 验证自定义 OpenAI-compatible 服务继续遵守其较小上限，避免恢复策略制造非法请求。
test("自定义模型保留 8192 token 输出上限", async () => {
	const requests = [];
	const { translator } = createTranslator(async (request) => {
		requests.push(request);
		return successfulResult(request);
	});
	const settings = createConfiguredSettings({
		provider: "custom",
		custom: {
			apiKey: "custom-key",
			baseUrl: "https://custom.example/v1",
			model: "private-model",
		},
	});

	await translate(translator, [{ id: "long", text: "a".repeat(6_000) }], settings);

	assert.equal(requests[0].maxOutputTokens, 8_192);
});

// 验证 length 响应会按原顺序自动拆成更小批次，并把截断请求也计入真实用量。
test("输出截断后自动拆批并合并译文与用量", async () => {
	const requests = [];
	const { translator } = createTranslator(async (request) => {
		requests.push(request);
		if (requests.length === 1) {
			return {
				text: "",
				finishReason: "length",
				usage: { inputTokens: 10, outputTokens: 16_384 },
			};
		}
		return successfulResult(request);
	});
	const segments = [
		{ id: "first", text: "a".repeat(200) },
		{ id: "second", text: "b".repeat(3_800) },
	];

	const result = await translate(translator, segments);

	assert.deepEqual(result.translations, segments.map((segment) => `译文：${segment.text}`));
	assert.equal(requests.length, 3);
	assert.deepEqual(
		requests.map((request) => JSON.parse(request.messages[0].content).segments.length),
		[2, 1, 1],
	);
	assert.deepEqual(result.usage, {
		apiCalls: 3,
		charactersSubmitted: 8_000,
		inputTokens: 30,
		cachedInputTokens: undefined,
		outputTokens: 16_394,
		tokenUsageMissingCalls: 0,
	});
});

// 验证父批拆分后仍截断的长单段可以继续拆文本，同时共享恢复预算保持请求有界。
test("批次恢复可以继续拆分其中的长单段", async () => {
	const requests = [];
	const { translator } = createTranslator(async (request) => {
		requests.push(request);
		const payload = JSON.parse(request.messages[0].content);
		const sourceCharacters = payload.segments.reduce(
			(sum, segment) => sum + segment.text.length,
			0,
		);
		if (payload.segments.length > 1 || sourceCharacters > 2_000) {
			return {
				text: "",
				finishReason: "length",
				usage: { inputTokens: 2, outputTokens: 10 },
			};
		}
		return {
			text: JSON.stringify({
				translations: payload.segments.map((segment) => ({
					id: segment.id,
					text: segment.text.toUpperCase(),
				})),
			}),
			finishReason: "stop",
			usage: { inputTokens: 2, outputTokens: 1 },
		};
	});
	const segments = [
		{ id: "short", text: "a".repeat(200) },
		{ id: "long", text: "b".repeat(3_800) },
	];

	const result = await translate(translator, segments);

	assert.deepEqual(result.translations, segments.map((segment) => segment.text.toUpperCase()));
	assert.equal(requests.length, 5);
	assert.equal(result.usage.apiCalls, 5);
	assert.equal(result.usage.charactersSubmitted, 11_800);
});

// 验证单个长段落也能被拆开翻译，随后按照目标语言规则重新拼回一个结果。
test("单个长段落输出截断后自动拆分文本", async () => {
	const requests = [];
	const { translator } = createTranslator(async (request) => {
		requests.push(request);
		if (requests.length === 1) {
			return { text: "", finishReason: "length", usage: {} };
		}
		return successfulResult(request, { inputTokens: 4, outputTokens: 3 });
	});

	const sourceText = `${"a".repeat(1_000)}.${"b".repeat(2_499)}`;
	const result = await translate(translator, [{ id: "long", text: sourceText }]);

	assert.equal(requests.length, 3);
	assert.deepEqual(
		requests.slice(1).map((request) => JSON.parse(request.messages[0].content).segments[0].text.length),
		[1_001, 2_499],
	);
	assert.equal(
		result.translations[0],
		`译文：${"a".repeat(1_000)}.译文：${"b".repeat(2_499)}`,
	);
	assert.equal(result.usage.apiCalls, 3);
	assert.equal(result.usage.charactersSubmitted, 7_000);
	assert.equal(result.usage.tokenUsageMissingCalls, 1);
});

// 验证自动恢复最多只拆分一层，避免异常模型持续截断时无限增加付费请求。
test("连续输出截断时有界停止恢复请求", async () => {
	let requestCount = 0;
	const { translator } = createTranslator(async (request) => {
		requestCount += 1;
		return {
			text: "",
			finishReason: "length",
			usage: { inputTokens: 1, outputTokens: request.maxOutputTokens },
		};
	});

	await assert.rejects(
		translate(translator, [
			{ id: "first", text: "a".repeat(2_000) },
			{ id: "second", text: "b".repeat(2_000) },
		]),
		(error) => {
			assert.match(error.message, /已自动缩小批次但仍未完成/u);
			assert.deepEqual(error.translationUsage, {
				apiCalls: 3,
				charactersSubmitted: 7_000,
				inputTokens: 3,
				cachedInputTokens: undefined,
				outputTokens: 22_920,
				tokenUsageMissingCalls: 0,
			});
			return true;
		},
	);
	assert.equal(requestCount, 3);
});

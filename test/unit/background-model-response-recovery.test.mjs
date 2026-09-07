import assert from "node:assert/strict";
import test from "node:test";

import { createConfiguredSettings } from "../helpers/background-harness.mjs";
import {
	createTranslator,
	successfulResult,
	translate,
} from "../helpers/model-translator-harness.mjs";

const segments = [
	{ id: "first", text: "Readers should be able to choose how they read an article." },
	{ id: "second", text: "A model can return broken JSON even when it reports a normal stop." },
];

function invalidResult(text = '{"translations":[{"id":"first","text":"未闭合的译文}') {
	return { text, finishReason: "stop", usage: { inputTokens: 3, outputTokens: 7 } };
}

// 验证正常结束但 JSON 损坏的批次自动缩小重试，并且只有通过内容校验后才记录 validated。
test("模型正常结束但 JSON 无法解析时缩批恢复", async () => {
	const requests = [];
	const { translator, debugEvents } = createTranslator(async (request) => {
		requests.push(request);
		return requests.length === 1 ? invalidResult() : successfulResult(request);
	});

	const result = await translate(translator, segments);

	assert.deepEqual(result.translations, segments.map((segment) => `译文：${segment.text}`));
	assert.equal(requests.length, 3);
	assert.equal(result.usage.apiCalls, 3);
	const totalCharacters = segments.reduce((sum, item) => sum + item.text.length, 0);
	assert.equal(result.usage.charactersSubmitted, totalCharacters * 2);
	assert.equal(result.usage.inputTokens, 23);
	assert.equal(result.usage.outputTokens, 17);
	assert.deepEqual(
		debugEvents
			.filter((event) => event.eventType.startsWith("model.response."))
			.map((event) => event.eventType),
		["model.response.invalid", "model.response.validated", "model.response.validated"],
	);
});

// 验证缺失对象、段落数量或 ID 错误均触发新请求，错误译文不会被宽松匹配后直接使用。
test("模型响应契约错误通过重新翻译恢复", async () => {
	for (const malformedText of [
		"This response is not a JSON object.",
		'{"message":"Please translate the page yourself."}',
		'{"translations":[]}',
		'{"translations":[{"id":"wrong","text":"错误"},{"id":"second","text":"译文"}]}',
	]) {
		let requestCount = 0;
		const { translator } = createTranslator(async (request) => {
			requestCount += 1;
			return requestCount === 1 ? invalidResult(malformedText) : successfulResult(request);
		});

		const result = await translate(translator, segments);

		assert.equal(requestCount, 3, malformedText);
		assert.deepEqual(result.translations, segments.map((segment) => `译文：${segment.text}`));
	}
});

// 验证单个长段落的格式错误也可以拆文本恢复，返回结果仍对应原始段落而非子段 ID。
test("单段 JSON 格式错误通过拆文本恢复一个译文", async () => {
	const requests = [];
	const { translator } = createTranslator(async (request) => {
		requests.push(request);
		return requests.length === 1 ? invalidResult() : successfulResult(request);
	});
	const text = "a".repeat(500) + "." + "b".repeat(700);

	const result = await translate(translator, [{ id: "article", text }]);

	assert.equal(result.translations.length, 1);
	assert.equal(result.translations[0], `译文：${"a".repeat(500)}.译文：${"b".repeat(700)}`);
	assert.equal(requests.length, 3);
});

// 验证连续格式错误与输出截断共用两次拆分预算，失败时带回全部已产生用量。
test("格式错误与输出截断共享恢复预算", async () => {
	let requestCount = 0;
	const { translator, debugEvents } = createTranslator(async () => {
		requestCount += 1;
		return requestCount === 2
			? { ...invalidResult(), finishReason: "length" }
			: invalidResult();
	});

	await assert.rejects(translate(translator, segments), (error) => {
		assert.match(error.message, /自动缩小批次/u);
		assert.equal(error.translationUsage.apiCalls, 3);
		assert.equal(error.translationUsage.inputTokens, 9);
		assert.equal(error.translationUsage.outputTokens, 21);
		return true;
	});
	assert.equal(requestCount, 3);
	assert.equal(debugEvents.some((event) => event.eventType === "model.response.validated"), false);
});

// 验证第一个恢复子批完成后取消会封锁后续请求，同时保留错误响应与成功子批的用量。
test("格式恢复过程中取消不继续上传剩余原文", async () => {
	const controller = new AbortController();
	let requestCount = 0;
	const { translator } = createTranslator(async (request) => {
		requestCount += 1;
		if (requestCount === 1) return invalidResult();
		controller.abort(new Error("翻译已取消"));
		return successfulResult(request);
	});

	await assert.rejects(
		translate(translator, segments, createConfiguredSettings(), controller.signal),
		(error) => {
			assert.equal(error.message, "翻译已取消");
			assert.equal(error.translationUsage.apiCalls, 2);
			assert.equal(error.translationUsage.inputTokens, 13);
			assert.equal(error.translationUsage.outputTokens, 12);
			return true;
		},
	);
	assert.equal(requestCount, 2);
});

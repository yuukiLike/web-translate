import assert from "node:assert/strict";
import test from "node:test";

import {
	createMessageViews,
	createRequestCapture,
	formatDebugJson,
	parseMessageContent,
	requestParameters,
} from "../../src/options/debugPayload.js";

// 元数据不能代替真正捕获的正文，旧记录或无效记录必须明确显示缺失。
test("请求正文缺失时不按模型或语言元数据补写内容", () => {
	for (const requestPayload of [undefined, null, "{invalid", [], "null"]) {
		const capture = createRequestCapture({
			model: "deepseek-v4-flash",
			sourceLanguage: "en",
			targetLanguage: "zh",
			segmentCount: 12,
			requestPayload,
		});
		assert.deepEqual(capture, { payload: null, truncated: false, omittedFields: [], status: "missing" });
	}
});

// 安全投影使用后台同一份规则，未知字段和敏感字段的值不会进入视图或复制内容。
test("请求正文视图移除未知字段并保留未记录字段清单", () => {
	const capture = createRequestCapture({
		requestPayload: {
			model: "deepseek-v4-flash",
			max_tokens: 1024,
			thinking: { type: "disabled", secret: "private-thinking" },
			messages: [{ role: "user", content: "原文", internal: "private-message" }],
			apiKey: "private-key",
			headers: { Authorization: "private-header" },
			unknown: "private-field",
		},
	});
	assert.deepEqual(capture.payload, {
		model: "deepseek-v4-flash",
		max_tokens: 1024,
		thinking: { type: "disabled" },
		messages: [{ role: "user", content: "原文" }],
	});
	assert.equal(capture.status, "partial");
	assert.deepEqual(capture.omittedFields, ["other_field", "thinking.other_field", "messages.other_field"]);
	assert.doesNotMatch(formatDebugJson(capture.payload), /private-/u);
});

// 重新投影已经脱敏的正文不会丢失发送端报告的缺失信息。
test("请求正文合并发送端与本地投影的截断和遗漏状态", () => {
	const capture = createRequestCapture({
		requestPayload: { model: "model", messages: [{ role: "user", content: "剩余正文" }], unknown: 1 },
		requestPayloadTruncated: true,
		requestPayloadOmittedFields: ["headers", "unknown", "headers", "thinking.other_field", "tools", null, 4],
	});
	assert.equal(capture.truncated, true);
	assert.equal(capture.status, "partial");
	assert.deepEqual(capture.omittedFields, ["other_field", "thinking.other_field", "tools"]);
	assert.equal(createRequestCapture({ requestPayloadTruncated: true }).status, "missing");
});

// 历史事件中的未知字段名也可能含敏感内容，视图必须沿用后台同一套安全名称规则。
test("请求正文遗漏字段清单不会直接展示历史未知字段名", () => {
	const capture = createRequestCapture({
		requestPayload: { model: "model" },
		requestPayloadOmittedFields: [
			"private-key-in-field-name",
			"thinking.private-key-in-field-name",
			"messages.reasoning_content",
		],
	});
	assert.equal(capture.status, "partial");
	assert.deepEqual(capture.omittedFields, ["other_field", "thinking.other_field", "messages.reasoning_content"]);
	assert.doesNotMatch(JSON.stringify(capture), /private-key/u);
});

// 旧视图的 40k 字符上限不能再次破坏正文；完整快照仍可反序列化和按原文查看。
test("完整正文超过旧 40k 限额时不进行二次静默截断", () => {
	const content = `第一行\n${"a".repeat(70_000)}\n末行`;
	const capture = createRequestCapture({
		requestPayload: JSON.stringify({ model: "model", messages: [{ role: "user", content }] }),
	});
	assert.equal(capture.status, "complete");
	assert.equal(capture.truncated, false);
	assert.equal(capture.payload.messages[0].content, content);
	const json = formatDebugJson(capture.payload);
	assert.ok(json.length > 40_000);
	assert.deepEqual(JSON.parse(json), capture.payload);
	assert.equal(createMessageViews(capture.payload)[0].content, content);
});

// 超过后台硬限额会保留真实前缀并明确标记，不能误报为完整正文。
test("超过共享记录上限的正文显式标为部分记录", () => {
	const content = "长".repeat(300_000);
	const capture = createRequestCapture({ requestPayload: { messages: [{ role: "user", content }] } });
	assert.equal(capture.status, "partial");
	assert.equal(capture.truncated, true);
	assert.ok(capture.payload.messages[0].content.length < content.length);
	assert.ok(content.startsWith(capture.payload.messages[0].content));
});

// 分片视图从实际 user 消息解析语言和正文，保留换行、顺序、标识及完整 JSON。
test("翻译消息 JSON 解码为带真实换行的有序分片", () => {
	const value = {
		source_language: "English",
		target_language: "Simplified Chinese",
		segments: [
			{ id: "segment-2", text: "Line one\nLine two", extra: "still in raw JSON" },
			{ id: "segment-1", text: "<script>alert(1)</script>" },
		],
	};
	const parsed = parseMessageContent(JSON.stringify(value));
	assert.equal(parsed.format, "json");
	assert.deepEqual(parsed.value, value);
	assert.deepEqual(parsed.translation, {
		sourceLanguage: "English",
		targetLanguage: "Simplified Chinese",
		segments: value.segments.map(({ id, text }) => ({ id, text })),
	});
	assert.equal(parsed.translation.segments[0].text, "Line one\nLine two");
});

// 非法或不符合翻译协议的嵌套 JSON 保持原样，不捏造分片或丢弃其他字段。
test("非法 JSON 与非翻译 JSON 保留可审查的原始内容", () => {
	for (const text of ["普通指令\n下一行", '{"segments":[{"id":"a"', "<script>alert(1)</script>"]) {
		assert.deepEqual(parseMessageContent(text), { format: "text", value: text, translation: null });
	}
	for (const value of [null, [1, 2], { segments: [{ id: "a", text: 12 }] }, { other: "content" }]) {
		assert.deepEqual(parseMessageContent(JSON.stringify(value)), { format: "json", value, translation: null });
	}
});

// 参数视图从捕获正文直接提取，消息仍按实际顺序保留，两个视图均不修改原始快照。
test("消息和参数视图使用同一份捕获正文", () => {
	const payload = {
		model: "model",
		thinking: { type: "disabled" },
		max_tokens: 2000,
		messages: [{ role: "system", content: "instruction\nsecond line" }, { role: "user", content: "source" }],
	};
	const original = structuredClone(payload);
	const messages = createMessageViews(payload);
	assert.deepEqual(messages.map(({ role, content }) => ({ role, content })), payload.messages);
	assert.deepEqual(requestParameters(payload), { model: "model", thinking: { type: "disabled" }, max_tokens: 2000 });
	assert.deepEqual(payload, original);
	assert.deepEqual(createMessageViews(null), []);
});

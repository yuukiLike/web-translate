import assert from "node:assert/strict";
import test from "node:test";

import { parseModelTranslations } from "../../src/core/model-response.js";

// 只有模型响应契约错误携带可恢复代码，调用方无需用中文报错文案判断重试类型。
test("模型响应的格式、结构、数量和 ID 错误使用统一错误码", () => {
	const invalidResponses = [
		["没有返回对象", ["a"], "模型未返回 JSON 对象"],
		['{"translations": [}', ["a"], "模型返回的 JSON 无法解析"],
		['{"translations": []', ["a"], "模型未返回 JSON 对象"],
		['{"result": []}', ["a"], "模型返回中缺少 translations 数组"],
		['{"translations": []}', ["a"], "模型返回的译文数量与原文不一致"],
		['{"translations": [null]}', ["a"], "模型返回的译文数量与原文不一致"],
		['{"translations": [{"id":"a","text":1}]}', ["a"], "模型返回的译文数量与原文不一致"],
		['{"translations": [{"id":"b","text":"译文"}]}', ["a"], "模型返回的译文 ID 与原文不一致"],
		[
			'{"translations": [{"id":"a","text":"甲"},{"id":"a","text":"乙"}]}',
			["a", "b"],
			"模型返回的译文 ID 与原文不一致",
		],
	];
	for (const [content, expectedIds, message] of invalidResponses) {
		assert.throws(() => parseModelTranslations(content, expectedIds), {
			code: "MODEL_RESPONSE_INVALID",
			message,
		});
	}
});

// 译文可以合法包含引号、大括号、反斜线和换行，解析与按 ID 排序均不得改写正文。
test("合法 JSON 译文保留标点和转义内容并按原文 ID 排序", () => {
	const first = '引号 "quoted"、对象 {"value": 1}、路径 C:\\reader\\notes\n下一行';
	const second = "末尾花括号 } 和开头花括号 { 都是正文";
	const payload = JSON.stringify({
		translations: [{ id: "b", text: second }, { id: "a", text: ` ${first} ` }],
	});
	assert.deepEqual(parseModelTranslations(`\x60\x60\x60json\n${payload}\n\x60\x60\x60`, ["a", "b"]), [first, second]);
});

// 未转义引号属于损坏的 JSON，不得猜测性修补后把改变的正文当成有效译文。
test("解析器严格拒绝未转义的译文引号", () => {
	assert.throws(
		() => parseModelTranslations('{"translations":[{"id":"a","text":"他说 "hello""}]}', ["a"]),
		{ code: "MODEL_RESPONSE_INVALID", message: "模型返回的 JSON 无法解析" },
	);
});

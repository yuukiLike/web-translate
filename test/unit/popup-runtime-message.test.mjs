import assert from "node:assert/strict";
import test from "node:test";

import { sendRuntimeMessage } from "../../src/popup/runtime-message.js";

function createChrome(sendMessage) {
	return { runtime: { sendMessage } };
}

// 验证 Popup 消息只接受后台明确成功响应，并保留后台给出的具体错误。
test("Popup 运行时消息验证成功标记", async () => {
	assert.deepEqual(
		await sendRuntimeMessage(createChrome(async () => ({ ok: true, value: 1 })), { type: "OK" }),
		{ ok: true, value: 1 },
	);
	await assert.rejects(
		() => sendRuntimeMessage(createChrome(async () => ({ ok: false, error: "模拟失败" })), {}),
		/模拟失败/u,
	);
});

// 验证后台 Promise 永不结束时会在限定时间失败，Popup 不会永久保留读取占位。
test("Popup 运行时消息具有有界超时", async () => {
	await assert.rejects(
		() => sendRuntimeMessage(createChrome(() => new Promise(() => {})), {}, 5),
		/响应超时/u,
	);
});

import assert from "node:assert/strict";

/** 所有异步断言都有截止时间，失败时指出未发生的行为。 */
export async function waitFor(predicate, message = "等待条件成立超时", timeout = 3_000) {
	const deadline = Date.now() + timeout;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			assert.fail(message);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

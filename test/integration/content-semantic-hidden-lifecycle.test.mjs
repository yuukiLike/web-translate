import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const SOURCE_TEXT = "This stable article can become semantically hidden at runtime.";
const EMPTY_STATUS = "当前页面没有需要翻译的外语正文";
const COMPLETE_STATUS = "双语翻译完成，已覆盖 1 个文本块";
const WAIT_TIMEOUT = 5_000;

// 验证已翻译正文变为 aria-hidden 或 inert 时会撤销呈现与进度，恢复可见后仍可正常翻译。
test("运行期语义隐藏会丢弃并恢复正文", async () => {
	const harness = createContentHarness();
	try {
		const container = harness.document.createElement("section");
		const source = harness.document.createElement("p");
		source.textContent = SOURCE_TEXT;
		container.append(source);
		harness.root.append(container);
		harness.start();

		await waitFor(
			() => harness.statusText() === COMPLETE_STATUS,
			"初始稳定正文没有完成翻译",
			WAIT_TIMEOUT,
		);
		for (const [attribute, value] of [
			["aria-hidden", "true"],
			["inert", ""],
		]) {
			container.setAttribute(attribute, value);
			await waitFor(
				() =>
					harness.statusText() === EMPTY_STATUS &&
					source.dataset.btSource === undefined &&
					harness.getTranslation(source) === null,
					`${attribute} 没有丢弃正文呈现与进度`,
					WAIT_TIMEOUT,
			);

			container.removeAttribute(attribute);
			await waitFor(
				() =>
					harness.statusText() === COMPLETE_STATUS &&
					Boolean(harness.getTranslation(source)),
					`${attribute} 移除后正文没有恢复翻译`,
					WAIT_TIMEOUT,
			);
		}

		assert.equal(harness.requestCount(SOURCE_TEXT), 1);
	} finally {
		harness.dispose();
	}
});

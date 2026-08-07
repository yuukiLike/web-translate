import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const FRANKFURTER_MARKDOWN = [
	"# Frankfurter",
	"",
	"> Currency data API. Current and historical exchange rates for 201 currencies from 84 central banks and official sources. No authentication required. Open-source. Genuinely free, not \"free with limits.\"",
	"",
	"Not ECB-only: v2 blends rates from 84 central banks and official sources. The legacy v1 API (European Central Bank data, nested `rates` object) still works but is superseded by v2, which returns flat arrays.",
	"",
	"- Docs: https://frankfurter.dev",
	"- OpenAPI: https://api.frankfurter.dev/v2/openapi.json",
	"- MCP: https://mcp.frankfurter.dev",
	"- Self-host (Docker): https://frankfurter.dev/deploy/",
	"- Source: https://github.com/lineofflight/frankfurter",
	"",
	"## Examples",
	"",
	"https://api.frankfurter.dev/v2/rates",
	"https://api.frankfurter.dev/v2/rates?date=1999-01-04",
	"https://api.frankfurter.dev/v2/rates?base=USD&quotes=GBP,JPY",
	"https://api.frankfurter.dev/v2/rates?providers=ECB",
	"https://api.frankfurter.dev/v2/rates?from=2025-01-01&to=2025-12-31&group=month",
].join("\n");

// 验证浏览器为纯文本响应生成的根级 pre 会完整进入翻译，而不是被当作代码块丢弃。
test("纯文本 Markdown 文档可以翻译", async () => {
	const harness = createContentHarness({ contentType: "text/plain" });
	try {
		const plainText = harness.document.createElement("pre");
		plainText.textContent = FRANKFURTER_MARKDOWN;
		const existingTranslation = harness.document.createElement("span");
		existingTranslation.className = "bt-translation";
		existingTranslation.dataset.btOwned = "true";
		existingTranslation.textContent = "Existing translation must stay excluded.";
		plainText.append(existingTranslation);
		harness.document.body.append(plainText);
		harness.start();

		await waitFor(
			() => harness.translationRequests.length > 0,
			"纯文本 Markdown 没有进入翻译请求",
		);
		assert.deepEqual(
			harness.translationRequests.flatMap(({ texts }) => texts),
			[FRANKFURTER_MARKDOWN],
		);
		assert.equal(harness.requestCount(existingTranslation.textContent), 0);
	} finally {
		harness.dispose();
	}
});

// 验证 Markdown 查看器常见的根级 pre > code 包装仍被视为可读文档。
test("纯文本根节点兼容 code 包装", async () => {
	const harness = createContentHarness({ contentType: "text/markdown" });
	try {
		const plainText = harness.document.createElement("pre");
		const wrapper = harness.document.createElement("code");
		wrapper.textContent = "Readable Markdown documentation for exchange rates.";
		plainText.append(wrapper);
		harness.document.body.append(plainText);
		harness.start();

		await waitFor(
			() => Boolean(harness.getTranslation(plainText)),
			"带 code 包装的纯文本根节点没有生成译文",
		);
		assert.equal(harness.requestCount(wrapper.textContent), 1);
	} finally {
		harness.dispose();
	}
});

// 验证纯文本 MIME 不会放行页面内部的嵌套 pre，例外严格限制在 body 直属根节点。
test("纯文本页面中的嵌套代码块保持不翻译", async () => {
	const harness = createContentHarness({ contentType: "text/plain" });
	try {
		const nestedCode = harness.document.createElement("pre");
		nestedCode.textContent = "const nestedCode = true;";
		harness.root.append(nestedCode);
		harness.start();

		await waitFor(
			() => harness.statusText() === "当前页面没有需要翻译的外语正文",
			"嵌套代码块没有稳定收敛为跳过状态",
		);
		assert.equal(harness.getTranslation(nestedCode), null);
		assert.equal(harness.translationRequests.length, 0);
	} finally {
		harness.dispose();
	}
});

// 验证普通 HTML 页面中的 pre 仍被视为代码区域，避免把代码错误发送给翻译服务。
test("普通网页代码块保持不翻译", async () => {
	const harness = createContentHarness();
	try {
		const codeBlock = harness.document.createElement("pre");
		codeBlock.textContent = "const exchangeRate = await fetchLatestRates();";
		harness.root.append(codeBlock);
		harness.start();

		await waitFor(
			() => harness.statusText() === "当前页面没有需要翻译的外语正文",
			"普通代码块没有稳定收敛为跳过状态",
		);
		assert.equal(harness.getTranslation(codeBlock), null);
		assert.equal(harness.translationRequests.length, 0);
	} finally {
		harness.dispose();
	}
});

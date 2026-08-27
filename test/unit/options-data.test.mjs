import assert from "node:assert/strict";
import test from "node:test";

import {
	createCatalogInfo,
	createFallbackSettings,
} from "../../src/options/catalogData.js";
import { createDebugRequests, createDebugRows } from "../../src/options/debugRows.js";
import { createUsageRows } from "../../src/options/usageData.js";
import { createCatalogFixture } from "../helpers/catalog-fixture.mjs";

const catalog = await createCatalogFixture();

// 验证设置页只从本地目录生成模型名称、成本和来源信息。
test("模型目录视图使用固定本地数据", () => {
	const info = createCatalogInfo(catalog);
	assert.equal(info.error, "");
	assert.equal(info.sha, "14119152");
	assert.deepEqual(info.models.deepseek[0], {
		id: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		costText: "$0.14 / $0.28",
		contextText: "1M 上下文",
	});
});

// 验证核心不可用时的设置草稿仍提供完整过滤结构，避免设置页绑定缺失字段。
test("设置页回退数据包含全部内容过滤默认值", () => {
	assert.deepEqual(createFallbackSettings(catalog).contentFilters, {
		skipTechnicalIdentifiers: true,
		skipSocialMetadata: true,
		skipShortLinks: true,
	});
});

// 验证字符型和 token 型 Provider 使用各自正确的用量指标。
test("用量视图区分字符与 token 计费", () => {
	const rows = createUsageRows(
		{
			"2026-08": {
				azure: { apiCalls: 1, billedCharacters: 18 },
				deepseek: { apiCalls: 2, inputTokens: 9, outputTokens: 4 },
			},
		},
		"2026-08",
		(id) => id.toUpperCase(),
	);
	assert.equal(rows[0].metrics.at(-1).label, "计费字符");
	assert.equal(rows[1].metrics.at(-1).value, "9 / 4");
});

// 模型服务未返回 usage 时必须显示未知；部分请求缺失时也不能把已记录 token 冒充完整总量。
test("用量视图标明未知和部分未知 token", () => {
	const rows = createUsageRows(
		{
			"2026-08": {
				deepseek: { apiCalls: 1, charactersSubmitted: 12, tokenUsageMissingCalls: 1 },
				openai: {
					apiCalls: 2,
					inputTokens: 9,
					outputTokens: 4,
					tokenUsageMissingCalls: 1,
				},
			},
		},
		"2026-08",
	);
	assert.equal(rows[0].metrics.at(-1).value, "未知");
	assert.equal(rows[1].metrics.at(-1).value, "9 / 4（部分未知）");
});

// 全部来自持久缓存且没有发起 API 请求时，token 用量应明确显示为零而不是未知。
test("零次模型调用显示零 token 用量", () => {
	const [row] = createUsageRows(
		{ "2026-08": { deepseek: { apiCalls: 0, cachedCharacters: 12 } } },
		"2026-08",
	);
	assert.equal(row.metrics.at(-1).value, "0 / 0");
});

// 验证调试事件仅展示白名单字段，并移除 URL 中的凭据、查询参数和片段。
test("调试事件格式化不会泄露敏感字段", () => {
	const [row] = createDebugRows([
		{
			seq: 7,
			timestamp: "2026-08-04T08:00:00.000Z",
			eventType: "<img src=x onerror=alert(1)>",
			apiHost: "https://user:secret@api.example.com/v1",
			endpoint: "https://api.example.com/v1/chat?api_key=secret#fragment",
			requestBody: "must-not-render",
		},
	]);
	assert.equal(row.name, "<img src=x onerror=alert(1)>");
	assert.ok(row.fields.some((field) => field.value === "api.example.com"));
	assert.ok(row.fields.some((field) => field.value === "https://api.example.com/v1/chat"));
	assert.equal(JSON.stringify(row).includes("must-not-render"), false);
});

// DeepSeek 请求正文必须多行显示安全投影和截断状态，嵌套敏感字段仍不得进入视图。
test("调试事件格式化 DeepSeek 请求正文", () => {
	const [row] = createDebugRows([
		{
			seq: 8,
			timestamp: "2026-08-04T08:00:01.000Z",
			eventType: "sdk.request-start",
			provider: "deepseek",
			requestPayload: {
				model: "deepseek-v4-flash",
				max_tokens: 800,
				messages: [{ role: "user", content: "第一行\n第二行网页原文" }],
				thinking: { type: "disabled", secret: "must-not-render" },
				apiKey: "sk-must-not-render",
				headers: { Authorization: "Bearer must-not-render" },
			},
			requestPayloadTruncated: true,
		},
	]);
	const payload = row.fields.find((field) => field.key === "requestPayload");
	const truncated = row.fields.find((field) => field.key === "requestPayloadTruncated");

	assert.equal(payload.multiline, true);
	assert.match(payload.value, /第一行\\n第二行网页原文/u);
	assert.match(payload.value, /"max_tokens": 800/u);
	assert.doesNotMatch(payload.value, /apiKey|Authorization|must-not-render/u);
	assert.equal(truncated.value, "是");
});

// 验证成对请求事件会合并成可检索的请求记录，且搜索文本不含 secret query。
test("调试请求视图正确关联开始与结束事件", () => {
	const [request] = createDebugRequests([
		{
			seq: 8,
			timestamp: "2026-08-04T08:00:01.000Z",
			eventType: "sdk.request-start",
			requestId: "provider-request-1",
			provider: "deepseek",
			method: "POST",
			endpoint: "https://api.example.com/v1/chat?api_key=secret",
			status: "started",
		},
		{
			seq: 9,
			timestamp: "2026-08-04T08:00:01.052Z",
			eventType: "sdk.request-end",
			requestId: "provider-request-1",
			method: "POST",
			endpoint: "https://api.example.com/v1/chat?api_key=secret",
			httpStatus: 401,
			elapsedMs: 52,
			errorCode: "http_401",
			status: "error",
		},
	]);
	assert.equal(request.name, "POST api.example.com");
	assert.equal(request.badge, "HTTP 401");
	assert.equal(request.status, "error");
	assert.doesNotMatch(request.searchText, /api_key=secret/u);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
	createCatalogInfo,
	createDebugRequests,
	createDebugRows,
	createUsageRows,
} from "../../src/options/data.js";
import { createCatalogFixture } from "../helpers/catalog-fixture.mjs";

const catalog = await createCatalogFixture();

// 验证设置页只从本地目录生成模型名称、成本和来源信息。
test("模型目录视图使用固定本地数据", () => {
	const info = createCatalogInfo(catalog);
	assert.equal(info.error, "");
	assert.equal(info.sha, "14119152");
	assert.equal(info.models.deepseek[0].id, "deepseek-v4-flash");
	assert.equal(info.models.deepseek[0].optionLabel, "DeepSeek V4 Flash");
	assert.match(info.models.deepseek[0].label, /\$0\.14 \/ \$0\.28/u);
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

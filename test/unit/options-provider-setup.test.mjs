import assert from "node:assert/strict";
import test from "node:test";

import { createCore } from "../../src/core/create-core.js";
import { createProviderSetup } from "../../src/options/providerSetup.js";
import { createCatalogFixture } from "../helpers/catalog-fixture.mjs";

const core = createCore(await createCatalogFixture());
const customSettings = core.normalizeSettings({
	provider: "custom",
	sourceMode: "auto",
	targetMode: "zh",
	custom: { apiKey: "test-key", baseUrl: "https://translate.example/v1", model: "test-model" },
});

// 无效配置应在域名授权和任何保存消息之前失败，避免保存无法使用的服务。
test("设置保存先校验配置再执行副作用", async () => {
	const calls = [];
	const setup = createProviderSetup({
		core,
		permissions: { request: async () => calls.push("permission") },
		sendMessage: async (message) => calls.push(message.type),
	});
	await assert.rejects(setup.saveSettings({ provider: "custom" }), /API Key/u);
	assert.deepEqual(calls, []);
});

// 自定义 API 域名被拒绝后不得写入语言或服务配置，授权只申请规范化 origin。
test("拒绝自定义域名授权会停止保存", async () => {
	const permissionRequests = [];
	const messages = [];
	const setup = createProviderSetup({
		core,
		permissions: {
			contains: async () => false,
			request: async (request) => {
				permissionRequests.push(request);
				return false;
			},
		},
		sendMessage: async (message) => messages.push(message),
	});
	await assert.rejects(setup.saveSettings(customSettings), /需要授权/u);
	assert.deepEqual(permissionRequests, [{ origins: ["https://translate.example/*"] }]);
	assert.deepEqual(messages, []);
});

// 已授权域名不重复请求权限，并且先保存独立语言、再保存完整设置，最后用实际保存值继续。
test("设置保存复用授权并返回后台最终配置", async () => {
	const calls = [];
	const savedSettings = { ...customSettings, targetMode: "en" };
	const setup = createProviderSetup({
		core,
		permissions: {
			contains: async () => true,
			request: async () => assert.fail("已授权域名不应重复申请权限"),
		},
		sendMessage: async (message) => {
			calls.push(message);
			return { settings: savedSettings };
		},
	});
	assert.equal(await setup.saveSettings(customSettings), savedSettings);
	assert.deepEqual(calls.map(({ type }) => type), ["SET_LANGUAGE_PAIR", "SAVE_SETTINGS"]);
	assert.deepEqual(calls[0], { type: "SET_LANGUAGE_PAIR", sourceMode: "auto", targetLanguage: "zh" });
	assert.deepEqual(calls[1].settings, customSettings);
});

// 连接测试失败必须原样上报且不伪造成功消息，也不发出多余的用量刷新。
test("连接失败停止后续用量刷新", async () => {
	const calls = [];
	const failure = new Error("测试连接失败");
	const setup = createProviderSetup({
		core,
		sendMessage: async (message) => {
			calls.push(message.type);
			throw failure;
		},
	});
	await assert.rejects(setup.testConnection(), (error) => error === failure);
	assert.deepEqual(calls, ["TEST_PROVIDER"]);
});

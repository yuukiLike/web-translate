import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../../chrome-extension/manifest.json", import.meta.url), "utf8"));

// 权限新增必须重新审视读取边界，不能悄悄增加本机通信、文件系统或自动注入入口。
test("扩展声明不授予磁盘接口或自动读取网页", () => {
	assert.deepEqual([...manifest.permissions].sort(),
		["activeTab", "contextMenus", "offscreen", "scripting", "storage", "tts", "webNavigation"]);
	assert.deepEqual(manifest.content_scripts ?? [], []);
	assert.equal(manifest.externally_connectable, undefined);
	assert.deepEqual(manifest.web_accessible_resources ?? [], []);
});

// 默认网络权限只覆盖明确的服务主机；可选 HTTP 权限仅用于用户配置的回环 API 服务。
test("默认主机权限没有文件或全站通配范围", () => {
	for (const pattern of manifest.host_permissions) {
		const url = new URL(pattern);
		assert.equal(url.protocol, "https:");
		assert.equal(url.hostname.includes("*"), false);
	}
	const optional = manifest.optional_host_permissions;
	assert.deepEqual(optional.filter((pattern) => pattern.startsWith("http:")),
		["http://localhost/*", "http://127.0.0.1/*", "http://[::1]/*"]);
	assert.equal(optional.some((pattern) => pattern.startsWith("file:") || pattern === "<all_urls>"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { getPageAccessError, getPageOrigin } from "../../src/core/page-policy.js";

// 本地文件、常见内网名字和所有 IP 字面量在 URL 规范化后都不能成为翻译来源。
test("页面读取拒绝本地来源及 IP 编码变体", () => {
	const blocked = [
		"file:///audit/project/notes.txt", "filesystem:https://example.com/temporary/private",
		"data:text/plain,private", "blob:https://example.com/audit", "about:blank", "chrome://settings/",
		"http://localhost:3000/", "http://sub.localhost/", "http://LOCALHOST./", "https://app.local/",
		"https://project.lan/", "https://project.internal/", "https://box.home.arpa/", "http://intranet/",
		"http://127.0.0.1:5173/", "http://127.1/", "http://2130706433/", "http://0x7f000001/",
		"https://10.0.0.1/", "https://172.16.0.1/", "https://192.168.1.1/", "http://169.254.169.254/",
		"http://[::1]/", "https://[::ffff:127.0.0.1]/", "https://[fd00::1]/", "http://[fe80::1]/",
		"http://0.0.0.0/", "https://8.8.8.8/", "https://user:secret@example.com/", "invalid", undefined,
	];
	for (const url of blocked) {
		assert.notEqual(getPageAccessError(url), "", "应拒绝本地或无法确认的来源");
		assert.equal(getPageOrigin(url), "");
	}
});

// 普通网页保持可用，域名中出现 localhost 字样不等于本地域名。
test("页面读取允许普通 HTTP(S) 域名", () => {
	for (const url of ["https://example.com/article", "http://example.com/", "https://localhost.example.com/"]) {
		assert.equal(getPageAccessError(url), "");
		assert.equal(getPageOrigin(url), new URL(url).origin);
	}
});

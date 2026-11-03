import assert from "node:assert/strict";
import test from "node:test";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

// 即使上层错误地注入了文件页面，生成脚本自身也不安装会读取 DOM 的控制器。
test("本地文件和开发页面不安装内容控制器或提交正文", () => {
	for (const url of ["file:///audit/notes.txt", "http://localhost:3000/", "https://127.0.0.1/", "https://project.local/"]) {
		const harness = createContentHarness({ url, contentType: "text/plain" });
		try {
			const pre = harness.document.createElement("pre");
			pre.textContent = "Synthetic local project secret. Do not upload this file.";
			harness.document.body.append(pre);
			harness.start();
			assert.equal(harness.window.__bilingualWebTranslatorController, undefined);
			assert.equal(harness.messages.length, 0);
		} finally {
			harness.dispose();
		}
	}
});

// 普通网页继续只提交可见正文，隐藏的附件地址与文件输入框不会被加入请求。
test("普通网页的翻译请求不包含文件控件或链接目标", async () => {
	const harness = createContentHarness();
	try {
		const source = harness.document.createElement("p");
		source.append("Read this article with ");
		const link = harness.document.createElement("a");
		link.href = "file:///audit/private-project.txt";
		link.textContent = "a reference";
		source.append(link);
		const input = harness.document.createElement("input");
		input.type = "file";
		harness.root.append(source, input);
		harness.start();
		await waitFor(() => harness.translationRequests.length > 0, "普通正文未进入翻译");
		const payload = JSON.stringify(harness.translationRequests);
		assert.match(payload, /Read this article/u);
		assert.doesNotMatch(payload, /file:|private-project/u);
	} finally {
		harness.dispose();
	}
});

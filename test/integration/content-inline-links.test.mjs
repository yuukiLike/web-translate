import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const releaseFixture = readFileSync(new URL("../fixtures/github-release-inline-links.html", import.meta.url), "utf8");

// 验证真实发布页的列表项整句提交，PR 编号与提交哈希在译文中保持行内可点击。
test("GitHub 发布日志保留整句与全部引用链接", async () => {
	const harness = createContentHarness({
		translateText: (text) => `译文：${text.replaceAll("#1772", "#9999").replaceAll("3dcead8", "wrong-hash")}`,
	});
	try {
		harness.window.location.href = "https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/releases/tag/2.2.0";
		harness.root.innerHTML = releaseFixture;
		const items = [...harness.root.querySelectorAll("li")].map((source) => ({
			source,
			text: source.textContent,
			links: [...source.querySelectorAll("a")].map((link) => ({ text: link.textContent, href: link.href })),
		}));
		harness.start();
		await waitFor(() => items.every(({ source }) => harness.getTranslation(source)), "发布日志没有生成译文");

		assert.equal(harness.translationRequests.flatMap(({ texts }) => texts).length, items.length);
		for (const { source, text, links } of items) {
			const translation = harness.getTranslation(source);
			assert.equal(translation.textContent, `译文：${text}`);
			assert.equal(translation.textContent.includes("\n"), false);
			assert.deepEqual([...translation.querySelectorAll("a")].map((link) => ({
				text: link.textContent,
				href: link.href,
			})), links);
			assert.equal(translation.querySelector("a a") === null, true, "译文链接不得嵌套");
		}
	} finally {
		harness.dispose();
	}
});

// 验证描述性链接可翻译标签，重复标签仍分别使用原地址，模型返回的 HTML 只显示为文字。
test("行内链接翻译文字并按身份恢复原地址", async () => {
	const harness = createContentHarness({
		translateText: (text) => text.replaceAll("Read docs", "阅读文档").replaceAll("Compare", "比较") + " <img src=x onerror=alert(1)>",
	});
	try {
		harness.root.innerHTML = '<p>Compare <a href="/first" target="_blank" rel="external"><strong>Read</strong> docs</a> with <a href="/second">Read docs</a>.</p>';
		const source = harness.root.querySelector("p");
		harness.start();
		await waitFor(() => harness.getTranslation(source), "描述性链接没有翻译");
		const translation = harness.getTranslation(source);
		const links = [...translation.querySelectorAll("a")];
		assert.deepEqual(links.map((link) => [link.textContent, link.href]), [
			["阅读文档", "https://example.com/first"],
			["阅读文档", "https://example.com/second"],
		]);
		assert.equal(links[0].target, "_blank");
		assert.ok(links[0].relList.contains("noopener"));
		assert.ok(links[0].relList.contains("external"));
		assert.equal(translation.querySelector("img") === null, true, "模型返回的 HTML 不得创建页面元素");
		assert.ok(translation.textContent.endsWith("<img src=x onerror=alert(1)>"));
		assert.doesNotMatch(translation.textContent, /\[\[\/?BT_LINK_/u);
	} finally {
		harness.dispose();
	}
});

// 验证相同正文只翻译一次，缓存命中仍各自恢复所在段落的链接地址。
test("同文段落复用译文而不串用链接地址", async () => {
	const harness = createContentHarness();
	try {
		harness.root.innerHTML = '<p>Read <a href="/first">the guide</a> before continuing.</p><p>Read <a href="/second">the guide</a> before continuing.</p>';
		const sources = [...harness.root.querySelectorAll("p")];
		harness.start();
		await waitFor(() => sources.every((source) => harness.getTranslation(source)), "重复正文没有全部翻译");
		assert.equal(harness.translationRequests.flatMap(({ texts }) => texts).length, 1);
		assert.deepEqual(sources.map((source) => harness.getTranslation(source).querySelector("a")?.href), [
			"https://example.com/first", "https://example.com/second",
		]);
	} finally {
		harness.dispose();
	}
});

// 验证原链接地址变化、href 移除及恢复时更新译文链接，且不向模型发送地址。
test("动态链接属性更新复用译文缓存", async () => {
	const harness = createContentHarness();
	try {
		harness.root.innerHTML = '<p>See the fix in <a href="/first">#1772</a>.</p>';
		const source = harness.root.querySelector("p");
		const originalLink = source.querySelector("a");
		harness.start();
		await waitFor(() => harness.getTranslation(source)?.querySelector("a"), "初始链接没有恢复");
		const initialRequest = harness.translationRequests[0].texts[0];
		assert.equal(initialRequest.includes("/first"), false);

		originalLink.href = "/updated";
		await waitFor(() => harness.getTranslation(source)?.querySelector("a")?.href === "https://example.com/updated", "href 变化没有更新译文");
		assert.equal(harness.requestCount(initialRequest), 1);

		originalLink.removeAttribute("href");
		await waitFor(() => {
			const translation = harness.getTranslation(source);
			return translation && !translation.querySelector("a");
		}, "href 移除后仍残留译文链接");
		assert.ok(harness.getTranslation(source).textContent.includes("#1772"));

		originalLink.href = "/restored";
		await waitFor(() => harness.getTranslation(source)?.querySelector("a")?.href === "https://example.com/restored", "恢复 href 后没有恢复译文链接");
		assert.equal(harness.requestCount(initialRequest), 1);
	} finally {
		harness.dispose();
	}
});

// 验证长句分片后链接仍只恢复一次，括号和编号没有因分片被丢弃。
test("长段落分片保留跨边界的链接标记", async () => {
	const harness = createContentHarness();
	try {
		const source = harness.document.createElement("p");
		source.append("a".repeat(3_493), " (PR ");
		const originalLink = harness.document.createElement("a");
		originalLink.href = "/pull/1772";
		originalLink.textContent = "#1772";
		source.append(originalLink, ") ", "b".repeat(400));
		harness.root.append(source);
		harness.start();
		await waitFor(() => harness.getTranslation(source), "长句没有完成翻译");
		const translation = harness.getTranslation(source);
		assert.equal(translation.querySelectorAll("a").length, 1);
		assert.equal(translation.querySelector("a").textContent, "#1772");
		assert.ok(harness.translationRequests.flatMap(({ texts }) => texts).length > 1);
		assert.doesNotMatch(translation.textContent, /\[\[\/?BT_LINK_/u);
	} finally {
		harness.dispose();
	}
});

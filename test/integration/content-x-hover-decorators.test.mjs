import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const contentStyles = readFileSync(
	new URL("../../chrome-extension/content/content.css", import.meta.url), "utf8",
);

// 验证正文和普通卡片的临时 hover 包裹层不会拆出新正文或搬动已有译文。
test("X hover 装饰层保留正文边界与译文挂载点", async () => {
	for (const atomic of [true, false]) {
		const harness = createContentHarness();
		const mutations = [];
		const observer = new harness.window.MutationObserver((records) => mutations.push(...records));
		try {
			harness.window.location.href = "https://x.com/home";
			const source = harness.document.createElement("div");
			if (atomic) source.dataset.testid = "tweetText";
			source.lang = "en";
			source.style.display = "block";
			const carrier = harness.document.createElement("span");
			carrier.style.display = "inline";
			const text = harness.document.createTextNode("Keep this translated card stable during hover.");
			carrier.append(text);
			source.append(carrier);
			harness.root.append(source);
			harness.start();
			await waitFor(() => Boolean(source.dataset.btTranslation), "初始译文没有生成");
			const translation = harness.getTranslation(source);
			const translationId = translation.id;
			observer.observe(source, { childList: true, subtree: true });

			for (let index = 0; index < 3; index += 1) {
				const decorator = harness.document.createElement("div");
				decorator.style.display = "block";
				carrier.insertBefore(decorator, text);
				decorator.append(text);
				await new Promise((resolve) => setTimeout(resolve, 250));
				assert.equal(translation.parentElement === carrier, true, "译文不能被搬入 hover 装饰层");
				assert.equal(source.dataset.btDescriptionId, translationId);
				decorator.replaceWith(text);
				await new Promise((resolve) => setTimeout(resolve, 250));
				assert.equal(translation.parentElement === carrier, true, "移除装饰层后应保留原挂载点");
				assert.equal(source.dataset.btDescriptionId, translationId);
			}

			const translationMoves = [...mutations, ...observer.takeRecords()].filter((record) =>
				[...record.addedNodes, ...record.removedNodes].includes(translation),
			);
			assert.equal(translationMoves.length, 0, "hover 期间不能移除或重新插入已有译文");
			assert.equal(source.querySelectorAll(".bt-translation").length, 1);
			assert.equal(harness.requestCount(text.data), 1);

			text.data = "A real content update still needs its own translation.";
			await waitFor(() => source.dataset.btTranslation === `译文：${text.data}`, "真实原文变化没有更新译文");
			assert.equal(harness.requestCount(text.data), 1);
		} finally {
			observer.disconnect();
			harness.dispose();
		}
	}
});

// 验证扩展自身的译文样式更新不会重新写入原文属性并触发宿主观察器。
test("X 已完整的译文不因样式 mutation 重写原文属性", async () => {
	const harness = createContentHarness();
	let sourceWrites = 0;
	const observer = new harness.window.MutationObserver((records) => { sourceWrites += records.length; });
	try {
		harness.window.location.href = "https://x.com/home";
		const source = harness.document.createElement("div");
		source.dataset.testid = "tweetText";
		source.textContent = "Translation styling should not rewrite the host source.";
		harness.root.append(source);
		harness.start();
		await waitFor(() => Boolean(source.dataset.btTranslation), "初始译文没有生成");
		observer.observe(source, { attributes: true });
		harness.getTranslation(source).style.setProperty("--bt-source-color", "red");
		await new Promise((resolve) => setTimeout(resolve, 250));
		assert.equal(sourceWrites, 0, "完整译文的样式变化不能反馈为原文属性写入");
		source.removeAttribute("data-bt-translation-lang");
		await new Promise((resolve) => setTimeout(resolve, 250));
		assert.equal(source.dataset.btTranslationLang, "zh-CN");
		assert.equal(sourceWrites, 2, "只记录宿主删除与扩展恢复的一个属性，其他属性不能重写");
	} finally {
		observer.disconnect();
		harness.dispose();
	}
});

// 验证展开多行 X 正文不改变原文空白语义，后续属性重扫仍复用同一个译文。
test("X 折叠正文展开后保留换行和译文身份", async () => {
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		const style = harness.document.createElement("style");
		style.textContent = contentStyles;
		harness.document.head.append(style);
		const source = harness.document.createElement("div");
		source.dataset.testid = "tweetText";
		source.style.whiteSpace = "pre-wrap";
		// Happy DOM 未实现 webkitLineClamp；仅补齐此浏览器读值，空白仍由真实 CSS 计算。
		const getComputedStyle = harness.window.getComputedStyle.bind(harness.window);
		harness.window.getComputedStyle = (element) => {
			const computed = getComputedStyle(element);
			if (element === source) Object.defineProperty(computed, "webkitLineClamp", { value: "3", configurable: true });
			return computed;
		};
		const text = "The first line of a folded post.\nThe second line remains a separate sentence.";
		source.textContent = text;
		harness.root.append(source);
		harness.start();
		await waitFor(() => Boolean(source.dataset.btTranslation), "折叠正文没有生成译文");
		const translation = harness.getTranslation(source);
		assert.equal(source.dataset.btReadingLayout, "expand");
		assert.equal(harness.window.getComputedStyle(source).whiteSpace, "pre-wrap");
		source.setAttribute("aria-label", "Hovered post");
		await new Promise((resolve) => setTimeout(resolve, 250));
		assert.equal(harness.getTranslation(source) === translation, true, "展开后的重扫不能重建译文");
		assert.equal(harness.requestCount(text), 1);
		assert.equal(harness.translationRequests.flatMap((request) => request.texts).length, 1);
	} finally {
		harness.dispose();
	}
});

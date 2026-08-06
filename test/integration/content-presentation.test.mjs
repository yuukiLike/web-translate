import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const contentStyles = readFileSync(
	new URL("../../chrome-extension/content/content.css", import.meta.url),
	"utf8",
);

function installContentStyles(document) {
	const style = document.createElement("style");
	style.textContent = contentStyles;
	document.head.append(style);
}

function appendControl(document, parent, tagName, text, attributes = {}) {
	const control = document.createElement(tagName);
	control.textContent = text;
	control.style.fontSize = "20px";
	for (const [name, value] of Object.entries(attributes)) {
		control.setAttribute(name, value);
	}
	parent.append(control);
	return control;
}

function pixelValue(value) {
	const pixels = Number.parseFloat(value);
	assert.equal(Number.isFinite(pixels), true, `无法解析像素值：${value}`);
	return pixels;
}

// 验证正文译文保持源字号与完整不透明度，并把原段落间距移到译文之后。
test("正文译文清晰且段落配对间距紧凑", async () => {
	const harness = createContentHarness();
	try {
		installContentStyles(harness.document);
		const { source } = harness.addArticle("Exchange rates and currency data API");
		source.style.color = "rgb(40, 50, 60)";
		source.style.fontFamily = '"Source Sans 3", sans-serif';
		source.style.fontSize = "20px";
		source.style.fontWeight = "400";
		source.style.lineHeight = "30px";
		source.style.marginBottom = "24px";

		harness.start();
		await waitFor(
			() => Boolean(harness.getTranslation(source)),
			"正文没有生成可检查排版的译文",
		);

		const translation = harness.getTranslation(source);
		const sourceStyle = harness.window.getComputedStyle(source);
		const translationStyle = harness.window.getComputedStyle(translation);

		assert.equal(translation.lang, "zh-CN");
		assert.equal(translationStyle.opacity, "1");
		assert.equal(pixelValue(translationStyle.fontSize), pixelValue(sourceStyle.fontSize));
		assert.equal(translationStyle.color, sourceStyle.color);
		assert.equal(sourceStyle.marginBottom, "24px");
		assert.equal(
			translation.style.getPropertyValue("--bt-source-margin-bottom"),
			"24px",
		);
		assert.equal(translationStyle.marginBottom, "24px");
		assert.match(
			translationStyle.marginTop.replaceAll(" ", ""),
			/^calc\([\d.]+(?:em|px)-24px\)$/u,
		);
		assert.match(
			contentStyles,
			/margin-top:\s*calc\(0\.1em\s*-\s*var\(--bt-source-margin-bottom,\s*0px\)\)/u,
		);
		assert.match(
			contentStyles,
			/\.bt-translation\[data-bt-owned="true"\]:lang\(zh\)\s*\{[^}]*font-family:[^}]*"PingFang SC"[^}]*"Noto Sans CJK SC"[^}]*"Microsoft YaHei"/su,
		);
	} finally {
		harness.dispose();
	}
});

// 验证普通短按钮默认翻译并使用较小字号，而免翻译术语和短链接仍保持原样。
test("短按钮使用紧凑双语排版且免翻译标签仍被过滤", async () => {
	const harness = createContentHarness();
	try {
		installContentStyles(harness.document);
		const nativeButton = appendControl(
			harness.document,
			harness.root,
			"button",
			"Submit",
		);
		const roleButton = appendControl(
			harness.document,
			harness.root,
			"div",
			"Try it now",
			{ role: "button" },
		);
		const shortLink = appendControl(
			harness.document,
			harness.root,
			"a",
			"Read docs",
		);
		const ignoredTermButton = appendControl(
			harness.document,
			harness.root,
			"button",
			"GitHub",
		);

		harness.start();
		await waitFor(
			() =>
				Boolean(harness.getTranslation(nativeButton)) &&
				Boolean(harness.getTranslation(roleButton)),
			"短按钮没有生成译文",
		);

		for (const button of [nativeButton, roleButton]) {
			const translation = harness.getTranslation(button);
			const buttonSize = pixelValue(harness.window.getComputedStyle(button).fontSize);
			const translationStyle = harness.window.getComputedStyle(translation);

			assert.equal(translation.parentElement, button);
			assert.equal(pixelValue(translationStyle.fontSize) / buttonSize, 0.8);
			assert.equal(translationStyle.lineHeight, "1.25");
			assert.equal(harness.requestCount(button.firstChild.textContent), 1);
		}
		assert.equal(harness.getTranslation(shortLink), null);
		assert.equal(harness.requestCount(shortLink.textContent), 0);
		assert.equal(shortLink.dataset.btSource, undefined);
		assert.equal(harness.getTranslation(ignoredTermButton), null);
		assert.equal(harness.requestCount(ignoredTermButton.textContent), 0);
		assert.equal(ignoredTermButton.dataset.btSource, undefined);
	} finally {
		harness.dispose();
	}
});

// 验证行内来源不会把无效的下外边距搬到译文，避免制造负间距和内容重叠。
test("行内元素不转移下外边距", async () => {
	const harness = createContentHarness();
	try {
		installContentStyles(harness.document);
		const source = harness.document.createElement("span");
		source.lang = "en";
		source.textContent = "Inline account details should remain readable";
		source.style.display = "inline";
		source.style.marginBottom = "24px";
		harness.root.append(source);

		harness.start();
		await waitFor(() => Boolean(harness.getTranslation(source)), "行内正文没有生成译文");

		const translation = harness.getTranslation(source);
		const translationStyle = harness.window.getComputedStyle(translation);
		assert.equal(translation.style.getPropertyValue("--bt-source-margin-bottom"), "0px");
		assert.equal(translationStyle.marginBottom, "0px");
		assert.equal(translationStyle.marginTop.includes("24px"), false);
	} finally {
		harness.dispose();
	}
});

// 验证来源使用 normal 行高时译文继续使用 normal，不被固定倍率意外拉高。
test("normal 行高原样传递给译文", async () => {
	const harness = createContentHarness();
	try {
		installContentStyles(harness.document);
		const { source } = harness.addArticle("Normal line height should remain natural");
		source.style.fontSize = "20px";
		source.style.lineHeight = "normal";

		harness.start();
		await waitFor(() => Boolean(harness.getTranslation(source)), "normal 行高正文没有生成译文");

		const translation = harness.getTranslation(source);
		assert.equal(
			translation.style.getPropertyValue("--bt-translation-line-height"),
			"normal",
		);
		assert.equal(harness.window.getComputedStyle(translation).lineHeight, "normal");
	} finally {
		harness.dispose();
	}
});

// 验证横向 flex 按钮会标记译文，并由样式契约为双语内容释放高度与换行空间。
test("横向 flex 按钮启用双语换行布局", async () => {
	const harness = createContentHarness();
	try {
		installContentStyles(harness.document);
		const inlineFlexButton = appendControl(
			harness.document,
			harness.root,
			"button",
			"Submit now",
		);
		inlineFlexButton.style.display = "inline-flex";
		inlineFlexButton.style.flexDirection = "row";
		inlineFlexButton.style.height = "36px";
		const roleFlexButton = appendControl(
			harness.document,
			harness.root,
			"div",
			"Try again",
			{ role: "button" },
		);
		roleFlexButton.style.display = "flex";
		roleFlexButton.style.flexDirection = "row";
		roleFlexButton.style.height = "36px";
		const columnFlexButton = appendControl(
			harness.document,
			harness.root,
			"button",
			"Continue reading",
		);
		columnFlexButton.style.display = "flex";
		columnFlexButton.style.flexDirection = "column";

		harness.start();
		await waitFor(
			() =>
				Boolean(harness.getTranslation(inlineFlexButton)) &&
				Boolean(harness.getTranslation(roleFlexButton)) &&
				Boolean(harness.getTranslation(columnFlexButton)),
			"横向 flex 按钮没有生成译文",
		);

		for (const button of [inlineFlexButton, roleFlexButton]) {
			const translation = harness.getTranslation(button);
			assert.equal(translation.dataset.btControlLayout, "row-flex");
			assert.equal(harness.window.getComputedStyle(translation).flexBasis, "100%");
		}
		const columnTranslation = harness.getTranslation(columnFlexButton);
		assert.equal(columnTranslation.dataset.btControlLayout, undefined);
		assert.notEqual(harness.window.getComputedStyle(columnTranslation).flexBasis, "100%");
		assert.match(
			contentStyles,
			/button:has\(>\s*\.bt-translation\[data-bt-owned="true"\]\)\s*,\s*\[role="button"\]:has\(>\s*\.bt-translation\[data-bt-owned="true"\]\)\s*\{[^}]*height:\s*auto\s*!important/u,
		);
		assert.match(
			contentStyles,
			/button:has\(>\s*\.bt-translation\[data-bt-control-layout="row-flex"\]\)\s*,\s*\[role="button"\]:has\(>\s*\.bt-translation\[data-bt-control-layout="row-flex"\]\)\s*\{[^}]*flex-wrap:\s*wrap\s*!important/u,
		);
	} finally {
		harness.dispose();
	}
});

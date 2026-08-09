import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";

const GENERATED_DATASET_NAMES = [
	"btSource",
	"btGeneratedOwned",
	"btPresentation",
	"btPresentationRun",
	"btTranslation",
	"btTranslationLang",
	"btDescriptionId",
];

// 验证 removal record 尚未交付时停止运行，也能清理脱离文档的 X 生成译文。
test("X 停止运行清理尚未交付的脱离帖子", async () => {
	const sourceText = "A detached X post must not revive after translation stops.";
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		const article = harness.document.createElement("article");
		const source = harness.document.createElement("div");
		const text = harness.document.createElement("span");
		const hostDescription = harness.document.createElement("span");
		source.dataset.testid = "tweetText";
		text.textContent = sourceText;
		hostDescription.id = "host-detached-description";
		source.setAttribute("aria-describedby", hostDescription.id);
		source.append(text);
		article.append(source);
		harness.root.append(article, hostDescription);

		harness.start();
		await waitFor(() => Boolean(source.dataset.btTranslation), "X 帖子没有生成译文");
		const descriptionId = source.dataset.btDescriptionId;
		article.remove();
		harness.injectAgain();
		await waitFor(
			() => harness.messages.some(({ type }) => type === "CANCEL_RUN"),
			"停止运行没有取消 X 翻译任务",
		);

		for (const name of GENERATED_DATASET_NAMES) {
			assert.equal(source.dataset[name], undefined);
		}
		assert.equal(source.getAttribute("aria-describedby"), hostDescription.id);
		assert.equal(harness.document.getElementById(descriptionId), null);
		harness.root.append(article);
		assert.equal(source.dataset.btTranslation, undefined);
		assert.equal(harness.requestCount(sourceText), 1);
	} finally {
		harness.dispose();
	}
});

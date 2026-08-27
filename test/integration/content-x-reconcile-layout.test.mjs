import assert from "node:assert/strict";
import test from "node:test";

import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";
import {
	assertGeneratedTranslation,
	assertSelectableTranslation,
} from "../helpers/generated-translation-assertions.mjs";

const SOURCE_TEXT = "A host commit must not observe a shorter translated X row.";
const TRANSLATION_TEXT = `译文：${SOURCE_TEXT}`;

// 验证 X 清理 tweetText 直属未知 child 后同步测量时，真实译文始终留在原生文本承载节点内。
test("X 直属 child reconcile 不产生可测量的译文高度缺口", async () => {
	const harness = createContentHarness();
	try {
		harness.window.location.href = "https://x.com/home";
		const source = harness.document.createElement("div");
		source.dataset.testid = "tweetText";
		const textCarrier = harness.document.createElement("span");
		textCarrier.textContent = SOURCE_TEXT;
		source.append(textCarrier);
		const nativeSourceChildren = [...source.childNodes];
		harness.root.append(source);

		harness.start();
		await waitFor(
			() => source.dataset.btTranslation === TRANSLATION_TEXT,
			"初始 X 译文没有生成",
		);
		const translation = assertGeneratedTranslation(source, TRANSLATION_TEXT);
		const synchronousHeights = [];

		for (let commit = 0; commit < 5; commit += 1) {
			removeUnknownDirectChildren(source, nativeSourceChildren);
			synchronousHeights.push(measureTranslatedRow(source));
			await waitFor(
				() => translation.isConnected,
				`第 ${commit + 1} 次宿主 commit 后译文没有恢复`,
			);
		}

		assert.deepEqual(synchronousHeights, [84, 84, 84, 84, 84]);
		assert.equal(translation.parentElement, textCarrier);
		assert.deepEqual([...source.childNodes], nativeSourceChildren);
		assertSelectableTranslation(harness.window, translation, TRANSLATION_TEXT);
		assert.equal(harness.requestCount(SOURCE_TEXT), 1);
	} finally {
		harness.dispose();
	}
});

function removeUnknownDirectChildren(source, nativeChildren) {
	const nativeSet = new Set(nativeChildren);
	for (const child of [...source.childNodes]) {
		if (!nativeSet.has(child)) {
			child.remove();
		}
	}
}

function measureTranslatedRow(source) {
	const visibleTranslation = source.querySelector(
		".bt-translation-generated[data-bt-owned='true']",
	);
	return visibleTranslation ? 84 : 48;
}

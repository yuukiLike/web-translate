import assert from "node:assert/strict";
import test from "node:test";

import { TIMING } from "../../src/content/constants.js";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";
import { getGeneratedTranslation } from "../helpers/generated-translation-assertions.mjs";

const sourceText = "A generated translation keeps its own identity during a short host update.";
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createPost(harness) {
	const article = harness.document.createElement("article");
	const source = harness.document.createElement("div");
	const carrier = harness.document.createElement("span");
	source.dataset.testid = "tweetText";
	carrier.textContent = sourceText;
	source.append(carrier);
	article.append(source);
	harness.root.append(article);
	return { article, source, carrier };
}

async function translatedPosts(context) {
	const harness = createContentHarness();
	context.after(() => harness.dispose());
	harness.window.location.href = "https://x.com/home";
	const posts = [createPost(harness), createPost(harness)];
	harness.start();
	await waitFor(
		() => posts.every(({ source }) => Boolean(source.dataset.btTranslation)),
		"两个同文帖子没有完成翻译",
	);
	for (const post of posts) {
		post.translation = getGeneratedTranslation(post.source);
		post.translationId = post.source.dataset.btDescriptionId;
	}
	assert.notEqual(posts[0].translationId, posts[1].translationId);
	return { harness, posts };
}

function assertRetained(post) {
	assert.equal(post.source.dataset.btDescriptionId, post.translationId);
	assert.equal(post.source.dataset.btTranslation, `译文：${sourceText}`);
	assert.ok(post.carrier.contains(post.translation), "原译文节点应继续属于原文 carrier");
}

function assertCleaned(post) {
	for (const key of Object.keys(post.source.dataset).filter((key) => key.startsWith("bt"))) {
		assert.fail(`移除后仍残留扩展属性 ${key}`);
	}
	assert.ok(post.translation.parentNode === null, "已清理译文不能留在断连 carrier 内");
}

// 验证 carrier、source 和整篇帖子短暂脱离时保留原节点，不从相邻同文帖子借用身份。
test("生成译文在共享防抖窗口内保留脱离节点身份", async (context) => {
	for (const boundary of ["carrier", "source", "article"]) {
		const { harness, posts: [post, neighbor] } = await translatedPosts(context);
		const node = post[boundary];
		const parent = node.parentNode;
		node.remove();
		await pause(30);
		assertRetained(post);
		assertRetained(neighbor);
		parent.append(node);
		await pause(TIMING.mutationDebounce + 40);
		assertRetained(post);
		assertRetained(neighbor);
		assert.equal(harness.requestCount(sourceText), 1);
		harness.dispose();
	}
});

// 验证永久移除在同一防抖窗口结算时释放属性和译文，同时保留其他同文帖子的状态。
test("生成译文永久移除后按期清理", async (context) => {
	for (const boundary of ["carrier", "source", "article"]) {
		const { harness, posts: [post, neighbor] } = await translatedPosts(context);
		post[boundary].remove();
		await waitFor(
			() => post.source.dataset.btDescriptionId === undefined,
			`${boundary} 永久移除后仍保留生成译文状态`,
		);
		assertCleaned(post);
		assertRetained(neighbor);
		assert.equal(harness.requestCount(sourceText), 1);
		harness.dispose();
	}
});

// 验证宽限期内停止会立即清理断连节点，重新挂回原文也不会复活已停止的译文。
test("停止运行清理宽限期中的所有脱离边界", async (context) => {
	for (const boundary of ["carrier", "source", "article"]) {
		const { harness, posts: [post, neighbor] } = await translatedPosts(context);
		const node = post[boundary];
		const parent = node.parentNode;
		node.remove();
		await pause(30);
		assertRetained(post);
		harness.injectAgain();
		await waitFor(
			() => harness.messages.some(({ type }) => type === "CANCEL_RUN"),
			"宽限期内停止没有取消翻译任务",
		);
		assertCleaned(post);
		assertCleaned(neighbor);
		parent.append(node);
		await pause(TIMING.mutationDebounce + 40);
		assertCleaned(post);
		assert.equal(harness.requestCount(sourceText), 1);
		harness.dispose();
	}
});

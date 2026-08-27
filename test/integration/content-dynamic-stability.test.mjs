import assert from "node:assert/strict";
import test from "node:test";
import { TIMING } from "../../src/content/constants.js";
import { CONTENT_VOLATILITY } from "../../src/content/volatile-content-tracker.js";
import { createContentHarness, waitFor } from "../helpers/content-dom-harness.mjs";
const TEXT = Object.freeze({
	agents: "Agents coordinate live work across the Cloudflare network.",
	workflow: "Workflow is preparing the next deployment stage.",
	story: "A customer story explains how teams ship reliable products.",
	ariaHidden: "Decorative network activity is hidden from assistive technology.",
	inert: "This decorative dashboard preview is intentionally inert.",
	ariaFalse: "This visible platform summary must remain translatable.",
	lazy: "This lazily loaded article remains stable after it appears.",
	animation: "This product description stays readable while its card animates.",
});

// 验证初始及动态插入的语义隐藏装饰都不进入流水线，同时保留稳定懒加载正文与 aria-hidden=false 正文。
test("语义隐藏边界不影响稳定动态正文", async () => {
	const harness = createContentHarness();
	try {
		const fixture = createCloudflareHomepageFixture(harness.document);
		removeParts(
			fixture.agents.source,
			fixture.workflow.source,
			fixture.customerStories.container,
			fixture.styleAnimation,
		);
		harness.root.append(fixture.root);
		harness.start();
		await waitFor(
			() => Boolean(harness.getTranslation(fixture.ariaFalse.source)),
			"aria-hidden=false 正文没有生成译文",
		);
		const lazy = fixture.mountLazyContent();
		const dynamicDecorations = fixture.mountDynamicDecorations();
		await waitFor(
			() => Boolean(harness.getTranslation(lazy.source)),
			"稳定的懒加载正文没有生成译文",
		);
		await waitFor(
			() => harness.statusText() === "双语翻译完成，已覆盖 2 个文本块",
			"语义隐藏内容被错误计入完成数量",
		);
		for (const item of [fixture.ariaHidden, fixture.inert, ...dynamicDecorations]) {
			assertUntouched(harness, item);
		}
		assert.equal(harness.requestCount(TEXT.ariaFalse), 1);
		assert.equal(harness.requestCount(TEXT.lazy), 1);
	} finally {
		harness.dispose();
	}
});

// 验证同节点扰动、textContent 更新和 fresh-node 轮播越过阈值后永久跳过，迟到响应也不能污染 DOM 或进度。
test("持续变化内容的请求与完成计数保持有界", async () => {
	const delayedResponse = Promise.withResolvers();
	const harness = createContentHarness({
		async translateText(text) {
			if (text === TEXT.agents) {
				await delayedResponse.promise;
			}
			return `译文：${text}`;
		},
	});
	try {
		const fixture = createCloudflareHomepageFixture(harness.document);
		removeParts(
			fixture.ariaHidden.container,
			fixture.inert.container,
			fixture.ariaFalse.container,
			fixture.styleAnimation,
		);
		const stable = fixture.mountLazyContent();
		harness.root.append(fixture.root);
		harness.start();
		await waitFor(
			() => harness.requestCount(TEXT.agents) === 1,
			"Agents 的初始延迟请求没有发出",
		);
		for (let frame = 1; frame <= CONTENT_VOLATILITY.changeLimit + 2; frame += 1) {
			fixture.agents.showFrame(frame);
		}
		await waitFor(
			() => fixture.agents.source.dataset.btSource === undefined,
			"Agents 越过变化阈值后仍保留运行标记",
		);
		delayedResponse.resolve();
		await waitFor(
			() => Boolean(harness.getTranslation(fixture.workflow.source)),
			"初始 Workflow 文本没有完成翻译",
		);
		for (let frame = 1; frame < CONTENT_VOLATILITY.changeLimit; frame += 1) {
			const workflowText = fixture.workflow.showFrame(frame);
			const story = fixture.customerStories.showFrame(frame);
			await waitFor(
				() =>
					harness.requestCount(workflowText) === 1 &&
					harness.requestCount(story.text) === 1,
				`动态内容第 ${frame} 帧没有进入预期的短防抖翻译`,
			);
			await waitFor(
				() =>
					Boolean(harness.getTranslation(fixture.workflow.source)) &&
					Boolean(harness.getTranslation(story.source)),
				`动态内容第 ${frame} 帧没有完成翻译`,
			);
		}
		const storyBeforeThreshold = fixture.customerStories.source;
		fixture.workflow.showFrame(CONTENT_VOLATILITY.changeLimit);
		fixture.customerStories.showFrame(CONTENT_VOLATILITY.changeLimit);
		await waitFor(
			() =>
				fixture.workflow.source.dataset.btSource === undefined &&
				storyBeforeThreshold.dataset.btSource === undefined,
			"持续替换内容越过阈值后仍保留运行标记",
		);
		await delay(TIMING.mutationDebounce + 50);
		const requestsAtSkip = countRequestedSegments(harness);
		for (
			let frame = CONTENT_VOLATILITY.changeLimit + 1;
			frame <= CONTENT_VOLATILITY.changeLimit + 2;
			frame += 1
		) {
			fixture.workflow.showFrame(frame);
			fixture.customerStories.showFrame(frame);
		}
		await delay(TIMING.mutationDebounce + 50);
		await waitFor(
			() => harness.statusText() === "双语翻译完成，已覆盖 1 个文本块",
			"易变历史帧没有从最终覆盖数量中移除",
		);
		assert.equal(countRequestedSegments(harness), requestsAtSkip);
		assert.equal(harness.requestCount(TEXT.agents), 1);
		assert.equal(harness.requestCount(TEXT.lazy), 1);
		for (const item of [fixture.agents, fixture.workflow, fixture.customerStories]) {
			assertSkippedPresentation(harness, item.source);
		}
		assert.ok(requestsAtSkip <= 1 + CONTENT_VOLATILITY.changeLimit * 2 + 1);
		assert.equal(harness.getTranslation(stable.source)?.textContent, `译文：${TEXT.lazy}`);
	} finally {
		delayedResponse.resolve();
		harness.dispose();
	}
});

// 验证 class/style 动画仍在运行时完成提示可以出现，且不会重建译文或重复请求。
test("纯样式动画不阻塞完成状态或重建译文", async () => {
	const harness = createContentHarness();
	let animationTimer = null;
	try {
		const fixture = createCloudflareHomepageFixture(harness.document);
		removeParts(
			fixture.agents.source,
			fixture.workflow.source,
			fixture.customerStories.container,
			fixture.ariaHidden.container,
			fixture.inert.container,
			fixture.ariaFalse.container,
		);
		harness.root.append(fixture.root);
		let animationFrame = 0;
		animationTimer = setInterval(() => {
			animationFrame += 1;
			fixture.styleAnimation.className = `cloudflare-pulse-${animationFrame % 2}`;
			fixture.styleAnimation.style.transform = `translateX(${animationFrame % 3}px)`;
		}, 12);
		harness.start();
		await waitFor(
			() => Boolean(harness.getTranslation(fixture.styleAnimation)),
			"样式动画正文没有生成译文",
		);
		const translation = harness.getTranslation(fixture.styleAnimation);
		await waitFor(
			() => harness.statusText() === "双语翻译完成，已覆盖 1 个文本块",
			"持续样式动画阻塞了完成提示",
		);
		const frameAtCompletion = animationFrame;
		await delay(50);
		assert.ok(frameAtCompletion > 0);
		assert.ok(animationFrame > frameAtCompletion);
		assert.equal(harness.getTranslation(fixture.styleAnimation), translation);
		assert.equal(harness.requestCount(TEXT.animation), 1);
		clearInterval(animationTimer);
		animationTimer = null;
		await delay(TIMING.visibilityDebounce + 50);
		assert.equal(harness.getTranslation(fixture.styleAnimation), translation);
	} finally {
		if (animationTimer !== null) {
			clearInterval(animationTimer);
		}
		harness.dispose();
	}
});

function createCloudflareHomepageFixture(document) {
	const root = document.createElement("section");
	root.dataset.fixture = "cloudflare-homepage";
	const agents = createParagraph(document, "agents", TEXT.agents);
	const workflow = createParagraph(document, "workflow", TEXT.workflow);
	const customerStoriesContainer = document.createElement("section");
	customerStoriesContainer.dataset.fixture = "customer-stories";
	const initialStory = createParagraph(document, "customer-story", TEXT.story);
	customerStoriesContainer.append(initialStory);
	const ariaHidden = createDecoration(document, "aria-hidden", TEXT.ariaHidden);
	ariaHidden.container.setAttribute("aria-hidden", "true");
	const inert = createDecoration(document, "inert", TEXT.inert);
	inert.container.setAttribute("inert", "");
	const ariaFalse = createDecoration(document, "aria-false", TEXT.ariaFalse);
	ariaFalse.container.setAttribute("aria-hidden", "false");
	const lazySlot = document.createElement("section");
	lazySlot.dataset.fixture = "lazy-content";
	const styleAnimation = createParagraph(document, "style-animation", TEXT.animation);
	root.append(
		agents, workflow, customerStoriesContainer, ariaHidden.container,
		inert.container, ariaFalse.container, lazySlot, styleAnimation,
	);
	const customerStories = {
		container: customerStoriesContainer,
		source: initialStory,
		showFrame(frame) {
			const text = `${TEXT.story} Carousel frame ${frame}.`;
			this.source = createParagraph(document, "customer-story", text);
			this.container.replaceChildren(this.source);
			return { source: this.source, text };
		},
	};
	return {
		root, customerStories, ariaHidden, inert, ariaFalse, styleAnimation,
		agents: createSameNodeActivity(agents, TEXT.agents),
		workflow: createTextContentActivity(workflow, TEXT.workflow),
		mountLazyContent() {
			const source = createParagraph(document, "lazy-article", TEXT.lazy);
			const article = document.createElement("article");
			article.append(source);
			lazySlot.append(article);
			return { container: article, source, text: TEXT.lazy };
		},
		mountDynamicDecorations() {
			const hidden = createDecoration(document, "dynamic-hidden", `${TEXT.ariaHidden} Dynamic.`);
			hidden.container.setAttribute("aria-hidden", "true");
			const disabled = createDecoration(document, "dynamic-inert", `${TEXT.inert} Dynamic.`);
			disabled.container.setAttribute("inert", "");
			root.append(hidden.container, disabled.container);
			return [hidden, disabled];
		},
	};
}
function createSameNodeActivity(source, initialText) {
	const textNode = source.firstChild;
	return {
		source, text: initialText,
		showFrame(frame) {
			textNode.data = `${initialText} Activity frame ${frame}.`;
		},
	};
}
function createTextContentActivity(source, initialText) {
	return {
		source, text: initialText,
		showFrame(frame) {
			const text = `${initialText} Status frame ${frame}.`;
			source.textContent = text;
			return text;
		},
	};
}
function createDecoration(document, name, text) {
	const container = document.createElement("div");
	container.dataset.fixture = name;
	const source = createParagraph(document, `${name}-text`, text);
	container.append(source);
	return { container, source, text };
}
function createParagraph(document, name, text) {
	const paragraph = document.createElement("p");
	paragraph.dataset.fixture = name;
	paragraph.textContent = text;
	return paragraph;
}
function assertUntouched(harness, item) {
	assertSkippedPresentation(harness, item.source);
	assert.equal(harness.requestCount(item.text), 0);
}
function assertSkippedPresentation(harness, source) {
	assert.equal(source.dataset.btSource, undefined);
	assert.equal(harness.getTranslation(source), null);
}
function removeParts(...parts) {
	parts.forEach((part) => part.remove());
}
function countRequestedSegments(harness) {
	return harness.translationRequests.reduce((total, request) => total + request.texts.length, 0);
}
function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

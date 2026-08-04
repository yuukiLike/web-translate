import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const catalogSource = readFileSync(
	new URL("../lib/provider-catalog.generated.js", import.meta.url),
	"utf8",
);
const coreSource = readFileSync(new URL("../lib/core.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content.js", import.meta.url), "utf8");

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class FakeText {
	constructor(value, environment) {
		this.nodeType = TEXT_NODE;
		this.parentElement = null;
		this.environment = environment;
		this.value = value;
	}

	get isConnected() {
		return Boolean(this.parentElement?.isConnected);
	}

	get textContent() {
		return this.value;
	}

	get nextSibling() {
		if (!this.parentElement) {
			return null;
		}
		const siblings = this.parentElement.childNodes;
		return siblings[siblings.indexOf(this) + 1] ?? null;
	}

	set textContent(value) {
		this.value = String(value);
		this.environment.notify({
			type: "characterData",
			target: this,
			addedNodes: [],
			removedNodes: [],
		});
	}
}

class FakeElement {
	constructor(tagName, environment, attributes = {}) {
		this.nodeType = ELEMENT_NODE;
		this.tagName = tagName.toUpperCase();
		this.environment = environment;
		this.parentElement = null;
		this.childNodes = [];
		this.attributes = new Map();
		this.dataset = {};
		this.className = "";
		this.style = {
			setProperty(name, value) {
				this[name] = value;
			},
		};
		this.rectangle = { top: 0, bottom: 24, width: 500, height: 24 };
		for (const [name, value] of Object.entries(attributes)) {
			this.setAttribute(name, value);
		}
	}

	get children() {
		return this.childNodes.filter((node) => node.nodeType === ELEMENT_NODE);
	}

	get isConnected() {
		return (
			this === this.environment.document?.documentElement ||
			Boolean(this.parentElement?.isConnected)
		);
	}

	get innerText() {
		let output = "";
		for (const node of this.childNodes) {
			if (node.nodeType === TEXT_NODE) {
				output += node.textContent;
				continue;
			}
			const childText = node.innerText;
			if (!childText) {
				continue;
			}
			const display = this.environment.getComputedStyle(node).display;
			if (display.startsWith("inline") || display === "contents") {
				output += childText;
				continue;
			}
			if (output && !output.endsWith("\n")) {
				output += "\n";
			}
			output += childText;
			if (!output.endsWith("\n")) {
				output += "\n";
			}
		}
		return output.replace(/^\n+|\n+$/gu, "");
	}

	get textContent() {
		return this.childNodes.map((node) => node.textContent ?? "").join("");
	}

	set textContent(value) {
		const removedNodes = [...this.childNodes];
		for (const node of removedNodes) {
			node.parentElement = null;
		}
		const text = new FakeText(String(value), this.environment);
		text.parentElement = this;
		this.childNodes = [text];
		if (this.isConnected) {
			this.environment.notify({
				type: "childList",
				target: this,
				addedNodes: [text],
				removedNodes,
			});
		}
	}

	get nextElementSibling() {
		if (!this.parentElement) {
			return null;
		}
		const siblings = this.parentElement.children;
		return siblings[siblings.indexOf(this) + 1] ?? null;
	}

	get nextSibling() {
		if (!this.parentElement) {
			return null;
		}
		const siblings = this.parentElement.childNodes;
		return siblings[siblings.indexOf(this) + 1] ?? null;
	}

	append(...nodes) {
		for (const value of nodes) {
			const node =
				typeof value === "string" ? new FakeText(value, this.environment) : value;
			if (node.parentElement) {
				node.remove();
			}
			node.parentElement = this;
			this.childNodes.push(node);
			if (this.isConnected) {
				this.environment.notify({
					type: "childList",
					target: this,
					addedNodes: [node],
					removedNodes: [],
				});
			}
		}
	}

	insertAdjacentElement(position, element) {
		assert.equal(position, "afterend");
		const parent = this.parentElement;
		if (!parent) {
			return null;
		}
		const index = parent.childNodes.indexOf(this);
		element.parentElement = parent;
		parent.childNodes.splice(index + 1, 0, element);
		if (parent.isConnected) {
			this.environment.notify({
				type: "childList",
				target: parent,
				addedNodes: [element],
				removedNodes: [],
			});
		}
		return element;
	}

	insertBefore(node, referenceNode) {
		if (node.parentElement) {
			node.remove();
		}
		const index = referenceNode === null ? this.childNodes.length : this.childNodes.indexOf(referenceNode);
		assert.ok(index >= 0);
		node.parentElement = this;
		this.childNodes.splice(index, 0, node);
		if (this.isConnected) {
			this.environment.notify({
				type: "childList",
				target: this,
				addedNodes: [node],
				removedNodes: [],
			});
		}
		return node;
	}

	remove() {
		const parent = this.parentElement;
		if (!parent) {
			return;
		}
		const index = parent.childNodes.indexOf(this);
		if (index >= 0) {
			parent.childNodes.splice(index, 1);
		}
		this.parentElement = null;
		if (parent.isConnected) {
			this.environment.notify({
				type: "childList",
				target: parent,
				addedNodes: [],
				removedNodes: [this],
			});
		}
	}

	contains(node) {
		for (let current = node; current; current = current.parentElement) {
			if (current === this) {
				return true;
			}
		}
		return false;
	}

	setAttribute(name, value) {
		const normalized = String(value);
		const previous = this.getAttribute(name);
		this.attributes.set(name, normalized);
		if (name === "class") {
			this.className = normalized;
		}
		if (name.startsWith("data-")) {
			this.dataset[toDatasetKey(name)] = normalized;
		}
		if (this.isConnected && previous !== normalized) {
			this.environment.notify({
				type: "attributes",
				target: this,
				attributeName: name,
				addedNodes: [],
				removedNodes: [],
			});
		}
	}

	getAttribute(name) {
		if (name === "class") {
			return this.className || null;
		}
		if (name.startsWith("data-")) {
			return this.dataset[toDatasetKey(name)] ?? null;
		}
		return this.attributes.get(name) ?? null;
	}

	addEventListener() {}

	getBoundingClientRect() {
		return { ...this.rectangle };
	}

	matches(selectorList) {
		return splitSelectors(selectorList).some((selector) => matchesSimpleSelector(this, selector));
	}

	closest(selector) {
		for (let current = this; current; current = current.parentElement) {
			if (current.matches(selector)) {
				return current;
			}
		}
		return null;
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector) {
		const matches = [];
		for (const child of this.children) {
			if (child.matches(selector)) {
				matches.push(child);
			}
			matches.push(...child.querySelectorAll(selector));
		}
		return matches;
	}
}

class FakeDocument {
	constructor(environment) {
		this.environment = environment;
		this.documentElement = new FakeElement("html", environment, { lang: "zh-CN" });
		this.body = new FakeElement("body", environment);
		this.documentElement.append(this.body);
	}

	createElement(tagName) {
		return new FakeElement(tagName, this.environment);
	}

	createTreeWalker(root) {
		const textNodes = [];
		const visit = (node) => {
			for (const child of node.childNodes) {
				if (child.nodeType === TEXT_NODE) {
					textNodes.push(child);
				} else {
					visit(child);
				}
			}
		};
		visit(root);
		let index = 0;
		return {
			nextNode() {
				const node = textNodes[index] ?? null;
				index += 1;
				return node;
			},
		};
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector) {
		const matches = [];
		if (this.documentElement.matches(selector)) {
			matches.push(this.documentElement);
		}
		matches.push(...this.documentElement.querySelectorAll(selector));
		return matches;
	}
}

class FakeMutationObserver {
	constructor(callback, environment) {
		this.callback = callback;
		this.environment = environment;
		this.root = null;
		this.records = [];
		this.scheduled = false;
		environment.observers.add(this);
	}

	observe(root) {
		this.root = root;
	}

	disconnect() {
		this.root = null;
		this.records = [];
	}

	enqueue(record) {
		this.records.push(record);
		if (this.scheduled) {
			return;
		}
		this.scheduled = true;
		queueMicrotask(() => {
			this.scheduled = false;
			const records = this.records.splice(0);
			if (this.root && records.length > 0) {
				this.callback(records);
			}
		});
	}
}

function toDatasetKey(name) {
	return name
		.slice(5)
		.replace(/-([a-z])/gu, (_match, character) => character.toUpperCase());
}

function splitSelectors(selectorList) {
	return selectorList.split(",").map((selector) => selector.trim());
}

function getFakeComputedStyle(element) {
	const inlineTags = new Set(["A", "IMG", "SPAN"]);
	return {
		display: element.style.display ?? (inlineTags.has(element.tagName) ? "inline" : "block"),
		color: "rgb(15, 20, 25)",
		flexDirection: element.style.flexDirection ?? "row",
		fontFamily: "system-ui",
		fontSize: "16px",
		fontWeight: "400",
		lineHeight: "24px",
		textAlign: "start",
		visibility: element.style.visibility ?? "visible",
		opacity: element.style.opacity ?? "1",
	};
}

function matchesSimpleSelector(element, selector) {
	if (selector === "[lang]:not(html):not(body)") {
		return (
			element.getAttribute("lang") !== null &&
			element.tagName !== "HTML" &&
			element.tagName !== "BODY"
		);
	}
	const tagMatch = selector.match(/^[a-z][a-z0-9-]*/iu);
	if (tagMatch && element.tagName !== tagMatch[0].toUpperCase()) {
		return false;
	}
	for (const classMatch of selector.matchAll(/\.([a-z0-9_-]+)/giu)) {
		if (!element.className.split(/\s+/u).includes(classMatch[1])) {
			return false;
		}
	}
	for (const attributeMatch of selector.matchAll(
		/\[([a-z0-9_-]+)(?:=(['"])(.*?)\2)?\]/giu,
	)) {
		const [, name, , expected] = attributeMatch;
		const actual = element.getAttribute(name);
		if (actual === null || (expected !== undefined && actual !== expected)) {
			return false;
		}
	}
	return Boolean(tagMatch || selector.startsWith(".") || selector.startsWith("["));
}

function createEnvironment() {
	const environment = {
		document: null,
		getComputedStyle: getFakeComputedStyle,
		observers: new Set(),
		notify(record) {
			for (const observer of this.observers) {
				if (observer.root?.contains(record.target) || observer.root === record.target) {
					observer.enqueue(record);
				}
			}
		},
	};
	environment.document = new FakeDocument(environment);
	return environment;
}

function createElement(environment, tagName, attributes = {}, children = []) {
	const element = new FakeElement(tagName, environment, attributes);
	element.append(...children);
	return element;
}

function text(environment, value) {
	return new FakeText(value, environment);
}

function createTweet(environment, value, options = {}) {
	const tweetText = createElement(environment, "div", {
		"data-testid": "tweetText",
		dir: "auto",
		lang: "en",
	});
	if (options.mention) {
		const mention = createElement(environment, "div", {}, [
			createElement(environment, "a", {}, [text(environment, "@openai")]),
		]);
		mention.style.display = "inline-flex";
		tweetText.append(
			mention,
			createElement(environment, "span", {}, [text(environment, " ships useful tools.")]),
		);
	} else if (options.fragments) {
		tweetText.append(
			...options.fragments.map((fragment) =>
				createElement(environment, "span", {}, [text(environment, fragment)]),
			),
		);
	} else {
		tweetText.append(createElement(environment, "span", {}, [text(environment, value)]));
		if (options.emoji) {
			tweetText.append(createElement(environment, "img", { alt: "🙂" }));
		}
	}
	const article = createElement(environment, "article", { "data-testid": "tweet" }, [tweetText]);
	return { article, tweetText };
}

async function waitFor(predicate, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error("Timed out waiting for condition");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

test("production content script renders and incrementally maintains every X-like text block", async () => {
	const environment = createEnvironment();
	const timeline = createElement(environment, "main");
	environment.document.body.append(timeline);
	const directMainStart = createElement(environment, "span", {}, [
		text(environment, "Direct "),
	]);
	const directMainEnd = createElement(environment, "span", {}, [
		text(environment, "main text."),
	]);
	const first = createTweet(environment, "First tweet uses nested spans.");
	const duplicate = createTweet(environment, "First tweet uses nested spans.");
	const mention = createTweet(environment, "", { mention: true });
	const emoji = createTweet(environment, "Fast and reliable.", { emoji: true });
	const fragmented = createTweet(environment, "", {
		fragments: [..."Split text remains complete."],
	});
	const paragraph = createElement(environment, "p", {}, [
		text(environment, "An ordinary paragraph."),
	]);
	const mixedParagraph = createElement(environment, "p", {}, [
		text(environment, "English before"),
		createElement(environment, "span", { lang: "zh-CN" }, [text(environment, "中文")]),
		text(environment, "English after."),
	]);
	const nestedParagraph = createElement(environment, "p", {}, [
		text(environment, "Nested paragraph."),
	]);
	const nestedContainer = createElement(environment, "div", {}, [
		text(environment, "Outer introduction."),
		nestedParagraph,
	]);
	const innerListItem = createElement(environment, "li", {}, [
		text(environment, "Child item."),
	]);
	const outerListItem = createElement(environment, "li", {}, [
		text(environment, "Parent item."),
		createElement(environment, "ul", {}, [innerListItem]),
	]);
	const followButton = createElement(environment, "button", {}, [
		text(environment, "Follow"),
	]);
	const hiddenFromAccessibilityButton = createElement(
		environment,
		"button",
		{ "aria-hidden": "true" },
		[text(environment, "See new posts")],
	);
	const suggestedName = createElement(environment, "div", {}, [
		text(environment, "Suggested account"),
	]);
	const suggestedReason = createElement(environment, "div", {}, [
		text(environment, "Recommended profile"),
	]);
	const suggestedUser = createElement(environment, "li", { "data-testid": "UserCell" }, [
		suggestedName,
		suggestedReason,
		createElement(environment, "button", {}, [text(environment, "Follow")]),
	]);
	const languageControlledParagraph = createElement(environment, "p", {}, [
		text(environment, "Language switches."),
	]);
	const languageSection = createElement(environment, "section", { lang: "en" }, [
		languageControlledParagraph,
	]);
	timeline.append(
		directMainStart,
		directMainEnd,
		first.article,
		duplicate.article,
		mention.article,
		emoji.article,
		fragmented.article,
		paragraph,
		mixedParagraph,
		nestedContainer,
		createElement(environment, "ul", {}, [outerListItem]),
		followButton,
		hiddenFromAccessibilityButton,
		createElement(environment, "ul", {}, [suggestedUser]),
		languageSection,
	);

	const translations = new Map([
		["Direct main text.", "主容器中的直接文本。"],
		["First tweet uses nested spans.", "第一条推文使用嵌套文本。"],
		["@openai ships useful tools.", "@openai 推出了实用工具。"],
		["Fast and reliable.", "快速且可靠。"],
		["Split text remains complete.", "拆分文本仍保持完整。"],
		["An ordinary paragraph.", "一个普通段落。"],
		["English before中文English after.", "中文嵌套前后的英文都被保留。"],
		["Outer introduction.", "外层介绍。"],
		["Nested paragraph.", "嵌套段落。"],
		["Parent item.", "父列表项。"],
		["Child item.", "子列表项。"],
		["Follow", "关注"],
		["See new posts", "查看新帖子"],
		["Suggested account", "推荐账号"],
		["Recommended profile", "推荐资料"],
		["Language switches.", "语言会切换。"],
		["语言已经切换。", "Language has switched."],
		["Initially hidden content.", "初始隐藏的内容。"],
		["Final status race content.", "结束状态竞态内容。"],
		["Retry after failure.", "失败后重试。"],
		["Trigger retry.", "触发重试。"],
		["New content loaded after scrolling.", "下滑后加载的新内容。"],
		["Updated tweet content.", "更新后的推文内容。"],
		["Late response after stop.", "停止后的迟到译文。"],
	]);
	const requestedTexts = [];
	const translationRequests = [];
	const messages = [];
	let blockFirstDoneStatus = true;
	let failRetryOnce = true;
	let releaseDoneStatus;
	let releaseLateResponse;
	const doneStatusGate = new Promise((resolve) => {
		releaseDoneStatus = resolve;
	});
	const lateResponseGate = new Promise((resolve) => {
		releaseLateResponse = resolve;
	});
	const context = vm.createContext({
		CSS: { escape: (value) => value },
		Error,
		Map,
		Math,
		MutationObserver: class extends FakeMutationObserver {
			constructor(callback) {
				super(callback, environment);
			}
		},
		Node: { ELEMENT_NODE, TEXT_NODE },
		NodeFilter: { SHOW_TEXT: 4 },
		Object,
		Promise,
		Set,
		String,
		WeakMap,
		WeakSet,
		chrome: {
			runtime: {
				async sendMessage(message) {
					messages.push(message);
					if (message.type === "START_RUN") {
						return {
							ok: true,
							settings: {
								provider: "mock",
								targetMode: "auto",
								translateDynamicContent: true,
								concurrency: 2,
							},
						};
					}
					if (message.type === "TRANSLATE_BATCH") {
						const texts = message.segments.map((segment) => segment.text);
						requestedTexts.push(...texts);
						translationRequests.push({
							sourceLanguage: message.sourceLanguage,
							targetLanguage: message.targetLanguage,
							texts,
						});
						if (texts.includes("Retry after failure.") && failRetryOnce) {
							failRetryOnce = false;
							return { ok: false, error: "temporary provider failure" };
						}
						if (
							message.segments.some(
								(segment) => segment.text === "Late response after stop.",
							)
						) {
							await lateResponseGate;
						}
						return {
							ok: true,
							results: message.segments.map((segment) => {
								const translation = translations.get(segment.text);
								assert.ok(translation, `missing mock translation for: ${segment.text}`);
								return { id: segment.id, text: translation };
							}),
						};
					}
					if (message.type === "STATUS" && message.state === "done" && blockFirstDoneStatus) {
						blockFirstDoneStatus = false;
						await doneStatusGate;
					}
					return { ok: true };
				},
			},
		},
		clearTimeout,
		document: environment.document,
		fetch() {
			throw new Error("network access is forbidden in this test");
		},
		getComputedStyle: getFakeComputedStyle,
		globalThis: null,
		setTimeout,
	});
	context.globalThis = context;
	context.window = context;
	context.innerHeight = 800;

	vm.runInContext(catalogSource, context, { filename: "provider-catalog.generated.js" });
	vm.runInContext(coreSource, context, { filename: "core.js" });
	vm.runInContext(contentSource, context, { filename: "content.js" });
	try {
		await waitFor(
			() => environment.document.querySelectorAll(".bt-translation[data-bt-owned='true']").length === 18,
		);
	} catch (error) {
		const translationCount = environment.document.querySelectorAll(
			".bt-translation[data-bt-owned='true']",
		).length;
		throw new Error(
			`${error.message}; translations=${translationCount}; messages=${JSON.stringify(messages)}`,
		);
	}

	assert.equal(requestedTexts.length, 16);
	assert.equal(requestedTexts.filter((value) => value === "First tweet uses nested spans.").length, 1);
	assert.ok(requestedTexts.includes("Split text remains complete."));
	assert.ok(!requestedTexts.includes("S p l i t text remains complete."));
	assert.ok(requestedTexts.includes("Outer introduction."));
	assert.ok(requestedTexts.includes("Nested paragraph."));
	assert.ok(!requestedTexts.some((value) => value.includes("Outer introduction.\nNested paragraph.")));
	assert.ok(requestedTexts.includes("Parent item."));
	assert.ok(requestedTexts.includes("Child item."));
	assert.ok(!requestedTexts.some((value) => value.includes("Parent item.\nChild item.")));
	assert.ok(requestedTexts.includes("Follow"));
	assert.ok(requestedTexts.includes("See new posts"));
	assert.ok(requestedTexts.includes("Suggested account"));
	assert.ok(requestedTexts.includes("Recommended profile"));
	assert.ok(
		!requestedTexts.some((value) =>
			value.includes("Suggested account\nRecommended profile")
		),
	);
	assert.equal(directMainEnd.nextElementSibling?.textContent, "主容器中的直接文本。");
	for (const [source, expectedTranslation] of [
		[first.tweetText, "第一条推文使用嵌套文本。"],
		[duplicate.tweetText, "第一条推文使用嵌套文本。"],
		[mention.tweetText, "@openai 推出了实用工具。"],
		[emoji.tweetText, "快速且可靠。"],
		[fragmented.tweetText, "拆分文本仍保持完整。"],
		[paragraph, "一个普通段落。"],
		[mixedParagraph, "中文嵌套前后的英文都被保留。"],
	]) {
		const translation = source.nextElementSibling;
		assert.ok(translation?.matches(".bt-translation[data-bt-owned='true']"));
		assert.equal(translation.textContent, expectedTranslation);
		assert.ok(!translation.textContent.includes("翻译"));
	}
	assert.equal(nestedContainer.children[0]?.textContent, "外层介绍。");
	assert.equal(nestedParagraph.nextElementSibling?.textContent, "嵌套段落。");
	assert.equal(outerListItem.children[0]?.textContent, "父列表项。");
	assert.equal(innerListItem.children.at(-1)?.textContent, "子列表项。");
	assert.equal(followButton.children.at(-1)?.textContent, "关注");
	assert.equal(hiddenFromAccessibilityButton.children.at(-1)?.textContent, "查看新帖子");
	assert.equal(suggestedName.nextElementSibling?.textContent, "推荐账号");
	assert.equal(suggestedReason.nextElementSibling?.textContent, "推荐资料");
	assert.equal(environment.document.querySelectorAll("[data-bt-source]").length, 18);
	const initialRunIds = new Set(
		environment.document
			.querySelectorAll(".bt-translation[data-bt-owned='true']")
			.map((translation) => translation.dataset.btRun),
	);
	assert.equal(initialRunIds.size, 1);
	const initialLanguageRequest = translationRequests.find((request) =>
		request.texts.includes("Language switches.")
	);
	assert.equal(initialLanguageRequest?.sourceLanguage, "en");
	assert.equal(initialLanguageRequest?.targetLanguage, "zh");

	await waitFor(
		() => messages.some((message) => message.type === "STATUS" && message.state === "done"),
	);
	const raceRequestStart = requestedTexts.length;
	const race = createTweet(environment, "Final status race content.");
	timeline.append(race.article);
	await new Promise((resolve) => setTimeout(resolve, 230));
	assert.equal(race.tweetText.nextElementSibling, null);
	releaseDoneStatus();
	await waitFor(
		() => race.tweetText.nextElementSibling?.textContent === "结束状态竞态内容。",
	);
	assert.deepEqual(requestedTexts.slice(raceRequestStart), ["Final status race content."]);

	const recoveryRequestStart = requestedTexts.length;
	emoji.tweetText.nextElementSibling.remove();
	await waitFor(() => emoji.tweetText.nextElementSibling?.textContent === "快速且可靠。");
	assert.deepEqual(requestedTexts.slice(recoveryRequestStart), ["Fast and reliable."]);

	const emptyRequestStart = requestedTexts.length;
	emoji.tweetText.children[0].childNodes[0].textContent = "";
	await waitFor(
		() =>
			emoji.tweetText.nextElementSibling === null &&
			emoji.tweetText.dataset.btSource === undefined,
	);
	assert.deepEqual(requestedTexts.slice(emptyRequestStart), []);
	emoji.tweetText.children[0].childNodes[0].textContent = "Fast and reliable.";
	await waitFor(() => emoji.tweetText.nextElementSibling?.textContent === "快速且可靠。");
	assert.deepEqual(requestedTexts.slice(emptyRequestStart), ["Fast and reliable."]);

	const languageRequestStart = requestedTexts.length;
	languageSection.setAttribute("lang", "zh-CN");
	await waitFor(
		() => !languageControlledParagraph.nextElementSibling?.matches(".bt-translation"),
	);
	assert.deepEqual(requestedTexts.slice(languageRequestStart), []);
	languageControlledParagraph.childNodes[0].textContent = "语言已经切换。";
	await waitFor(
		() => languageControlledParagraph.nextElementSibling?.textContent === "Language has switched.",
	);
	assert.deepEqual(requestedTexts.slice(languageRequestStart), ["语言已经切换。"]);
	const switchedLanguageRequest = translationRequests.find((request) =>
		request.texts.includes("语言已经切换。")
	);
	assert.equal(switchedLanguageRequest?.sourceLanguage, "zh");
	assert.equal(switchedLanguageRequest?.targetLanguage, "en");

	const styleRequestStart = requestedTexts.length;
	for (let index = 0; index < 20; index += 1) {
		timeline.setAttribute("class", `hover-state-${index}`);
	}
	await new Promise((resolve) => setTimeout(resolve, 320));
	assert.deepEqual(requestedTexts.slice(styleRequestStart), []);

	const layoutRequestStart = requestedTexts.length;
	languageSection.style.display = "flex";
	languageSection.style.flexDirection = "row";
	languageSection.setAttribute("style", "display:flex;flex-direction:row");
	await waitFor(
		() =>
			languageControlledParagraph.children.at(-1)?.textContent ===
			"Language has switched.",
	);
	assert.deepEqual(requestedTexts.slice(layoutRequestStart), ["语言已经切换。"]);

	const deferred = createTweet(environment, "Initially hidden content.");
	deferred.tweetText.style.display = "none";
	const deferredRequestStart = requestedTexts.length;
	timeline.append(deferred.article);
	await new Promise((resolve) => setTimeout(resolve, 230));
	assert.equal(deferred.tweetText.nextElementSibling, null);
	assert.deepEqual(requestedTexts.slice(deferredRequestStart), []);
	deferred.tweetText.style.display = "block";
	deferred.tweetText.setAttribute("style", "display:block");
	await waitFor(
		() => deferred.tweetText.nextElementSibling?.textContent === "初始隐藏的内容。",
	);
	assert.deepEqual(requestedTexts.slice(deferredRequestStart), ["Initially hidden content."]);
	deferred.article.remove();
	await waitFor(
		() =>
			deferred.tweetText.nextElementSibling === null &&
			deferred.tweetText.dataset.btSource === undefined,
	);

	const dynamic = createTweet(environment, "New content loaded after scrolling.");
	const dynamicRequestStart = requestedTexts.length;
	timeline.append(dynamic.article);
	await waitFor(() => dynamic.tweetText.nextElementSibling?.matches(".bt-translation") === true);
	assert.equal(
		environment.document.querySelectorAll(".bt-translation[data-bt-owned='true']").length,
		20,
	);
	assert.deepEqual(requestedTexts.slice(dynamicRequestStart), [
		"New content loaded after scrolling.",
	]);

	const updateRequestStart = requestedTexts.length;
	first.tweetText.children[0].childNodes[0].textContent = "Updated tweet content.";
	await waitFor(
		() => first.tweetText.nextElementSibling?.textContent === "更新后的推文内容。",
	);
	assert.equal(
		first.article.querySelectorAll(".bt-translation[data-bt-owned='true']").length,
		1,
	);
	assert.deepEqual(requestedTexts.slice(updateRequestStart), ["Updated tweet content."]);

	dynamic.article.remove();
	await waitFor(
		() =>
			dynamic.article.querySelectorAll(".bt-translation[data-bt-owned='true']").length === 0 &&
			dynamic.tweetText.dataset.btSource === undefined,
	);
	assert.equal(
		environment.document.querySelectorAll(".bt-translation[data-bt-owned='true']").length,
		19,
	);
	const reinsertRequestStart = requestedTexts.length;
	timeline.append(dynamic.article);
	await waitFor(() => dynamic.tweetText.nextElementSibling?.textContent === "下滑后加载的新内容。");
	assert.equal(
		dynamic.article.querySelectorAll(".bt-translation[data-bt-owned='true']").length,
		1,
	);
	assert.deepEqual(requestedTexts.slice(reinsertRequestStart), [
		"New content loaded after scrolling.",
	]);

	const retryRequestStart = requestedTexts.length;
	const retry = createTweet(environment, "Retry after failure.");
	timeline.append(retry.article);
	await waitFor(
		() =>
			requestedTexts
				.slice(retryRequestStart)
				.filter((value) => value === "Retry after failure.").length === 1,
	);
	assert.equal(retry.tweetText.nextElementSibling, null);
	const retryTrigger = createTweet(environment, "Trigger retry.");
	timeline.append(retryTrigger.article);
	await waitFor(
		() =>
			retry.tweetText.nextElementSibling?.textContent === "失败后重试。" &&
			retryTrigger.tweetText.nextElementSibling?.textContent === "触发重试。",
	);
	const retryTexts = requestedTexts.slice(retryRequestStart);
	assert.equal(retryTexts.filter((value) => value === "Retry after failure.").length, 2);
	assert.equal(retryTexts.filter((value) => value === "Trigger retry.").length, 1);

	const late = createTweet(environment, "Late response after stop.");
	timeline.append(late.article);
	await waitFor(() => requestedTexts.includes("Late response after stop."));
	await context.__bilingualWebTranslatorController.toggle();
	await waitFor(
		() => environment.document.querySelectorAll(".bt-translation[data-bt-owned='true']").length === 0,
	);
	assert.equal(environment.document.querySelectorAll("[data-bt-source]").length, 0);
	assert.ok(messages.some((message) => message.type === "CANCEL_RUN"));
	releaseLateResponse();
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(late.tweetText.nextElementSibling, null);
	assert.equal(
		environment.document.querySelectorAll(".bt-translation[data-bt-owned='true']").length,
		0,
	);
});

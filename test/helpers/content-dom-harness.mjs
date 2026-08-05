import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Window } from "happy-dom";

const catalogSource = readGenerated("provider-catalog.js");
const coreSource = readGenerated("core.js");
const contentSource = readGenerated("content-script.js");

function readGenerated(fileName) {
	return readFileSync(
		new URL(`../../chrome-extension/generated/${fileName}`, import.meta.url),
		"utf8",
	);
}

export function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

export async function waitFor(predicate, message, timeout = 3_000) {
	const deadline = Date.now() + timeout;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			assert.fail(message);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

export function createContentHarness({ targetMode = "auto", translateText } = {}) {
	const window = new Window({ url: "https://example.com/article" });
	const { document } = window;
	const messages = [];
	const translationRequests = [];
	let requestNumber = 0;

	Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
	Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
		configurable: true,
		value() {
			return { top: 0, right: 600, bottom: 24, left: 0, width: 600, height: 24 };
		},
	});

	const root = document.createElement("main");
	document.body.append(root);
	window.chrome = {
		runtime: {
			async sendMessage(message) {
				messages.push(structuredClone(message));
				if (message.type === "START_RUN") {
					return {
						ok: true,
						settings: {
							provider: "deepseek",
							targetMode,
							translateDynamicContent: true,
							concurrency: 2,
						},
					};
				}
				if (message.type !== "TRANSLATE_BATCH") {
					return { ok: true };
				}

				requestNumber += 1;
				translationRequests.push({
					runId: message.runId,
					sourceLanguage: message.sourceLanguage,
					targetLanguage: message.targetLanguage,
					texts: message.segments.map(({ text }) => text),
				});
				const results = await Promise.all(
					message.segments.map(async (segment) => ({
						id: segment.id,
						text: translateText
							? await translateText(segment.text, { message, requestNumber })
							: `译文：${segment.text}`,
					})),
				);
				return { ok: true, results };
			},
		},
	};

	function addArticle(text, { lang = "" } = {}) {
		const article = document.createElement("article");
		const source = document.createElement("p");
		if (lang) {
			source.lang = lang;
		}
		source.textContent = text;
		article.append(source);
		root.append(article);
		return { article, source };
	}

	function getTranslation(source) {
		const sibling = source.nextElementSibling;
		if (sibling?.matches(".bt-translation[data-bt-owned='true']")) {
			return sibling;
		}
		return source.querySelector(".bt-translation[data-bt-owned='true']");
	}

	function evaluateGeneratedRuntime() {
		window.eval(catalogSource);
		window.eval(coreSource);
		window.eval(contentSource);
	}

	return {
		addArticle,
		document,
		getTranslation,
		messages,
		root,
		translationRequests,
		window,
		dispose() {
			window.close();
		},
		injectAgain() {
			window.eval(contentSource);
		},
		requestCount(text) {
			return translationRequests.reduce(
				(count, request) => count + request.texts.filter((value) => value === text).length,
				0,
			);
		},
		start: evaluateGeneratedRuntime,
		statusText() {
			return document.querySelector(".bt-status__text")?.textContent ?? "";
		},
	};
}

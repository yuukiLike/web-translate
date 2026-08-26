import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { VolatileMutationFilter } from "../../src/content/dom/volatile-mutation-filter.js";
import { ContentVolatilityTracker } from "../../src/content/volatile-content-tracker.js";

const WINDOW_SIZE = 3;
const LAST_WINDOW_START = 15;

// 验证生产过滤器处理单条多删多增记录时，长时间 fresh 滑窗也不会让身份绕回易变阈值。
test("单记录整窗滑动超过九帧仍保持稳定", () =>
	withDomGlobals((window) => {
		const tracker = new ContentVolatilityTracker();
		const { discarded, filter } = createFilter(tracker);
		const boundary = window.document.createElement("section");
		let visible = createWindow(window.document, 1);
		boundary.append(...visible);
		window.document.body.append(boundary);

		for (let start = 2; start <= LAST_WINDOW_START; start += 1) {
			const previous = visible;
			visible = createWindow(window.document, start);
			boundary.replaceChildren(...visible);
			const mutation = {
				type: "childList",
				target: boundary,
				removedNodes: previous,
				addedNodes: visible,
				previousSibling: null,
				nextSibling: null,
			};

			const result = filter.filter([mutation]);

			assert.equal(result.accepted.length, 1);
			assert.equal(result.volatileRoots.size, 0);
			assert.equal(visible.some((element) => tracker.isVolatile(element)), false);
			assert.equal(discarded.includes(previous[0]), false);
		}
		filter.clear();
	}));

// 验证带唯一强语义键的动态项即使每帧换位，也会在换文阈值后进入易变状态。
test("换位且换文的唯一 ticker 仍累计易变历史", () =>
	withDomGlobals((window) => {
		const tracker = new ContentVolatilityTracker();
		const { filter } = createFilter(tracker);
		const boundary = window.document.createElement("section");
		let visible = createTickerWindow(window.document, 0, false);
		boundary.append(...visible);
		window.document.body.append(boundary);

		for (let frame = 1; frame <= 6; frame += 1) {
			const previous = visible;
			visible = createTickerWindow(window.document, frame, frame % 2 === 1);
			boundary.replaceChildren(...visible);
			filter.filter([{
				type: "childList",
				target: boundary,
				removedNodes: previous,
				addedNodes: visible,
				previousSibling: null,
				nextSibling: null,
			}]);

			const ticker = visible.find((element) => element.dataset.testid === "live-ticker");
			assert.equal(tracker.isVolatile(ticker), frame >= 3);
			assert.equal(
				visible
					.filter((element) => element !== ticker)
					.some((element) => tracker.isVolatile(element)),
				false,
			);
		}
		filter.clear();
	}));

// 验证已易变状态的旧文本与稳定新节点碰撞时，排除身份只沿唯一 id 传播。
test("动态 id 同文碰撞不会误伤稳定节点", () =>
	withDomGlobals((window) => {
		const tracker = new ContentVolatilityTracker();
		const { filter } = createFilter(tracker);
		const boundary = window.document.createElement("section");
		const oldTicker = createArticle(window.document, "Online");
		oldTicker.id = "live-status";
		const oldStable = createArticle(window.document, "Stable label");
		boundary.append(oldTicker, oldStable);
		window.document.body.append(boundary);
		const tickerIdentity = filter.lineage.identityFor(oldTicker);
		for (let change = 0; change < 3; change += 1) {
			tracker.recordChange(tickerIdentity, [oldTicker]);
		}
		const newStable = createArticle(window.document, "Online");
		const newTicker = createArticle(window.document, "Offline");
		newTicker.id = "live-status";
		boundary.replaceChildren(newStable, newTicker);

		filter.filter([{
			type: "childList",
			target: boundary,
			removedNodes: [oldTicker, oldStable],
			addedNodes: [newStable, newTicker],
			previousSibling: null,
			nextSibling: null,
		}]);

		assert.equal(tracker.isVolatile(newTicker), true);
		assert.equal(tracker.isVolatile(newStable), false);
		filter.clear();
	}));

function createFilter(tracker) {
	const discarded = [];
	const elementStore = {
		generatedSources: new Set(),
		getState: () => null,
		getTextOwner: () => null,
		hasState: () => false,
	};
	const scanner = {
		core: { hashText: (text) => text },
		currentCandidate: (element) => ({ element, text: element.textContent }),
		findContentUnit: (element) => element?.closest?.("p") ?? null,
		getPresentation: () => "flow",
		isExcluded: (element) => tracker.isVolatile(element),
	};
	const filter = new VolatileMutationFilter({
		tracker,
		elementStore,
		scanner,
		getRouteKey: () => "/feed",
		invalidator: { discard: (element) => discarded.push(element) },
	});
	return { discarded, filter };
}

function createWindow(document, start) {
	return Array.from({ length: WINDOW_SIZE }, (_, offset) => {
		const article = document.createElement("p");
		article.textContent = `Stable feed article ${start + offset}`;
		return article;
	});
}

function createTickerWindow(document, frame, tickerLast) {
	const ticker = createArticle(
		document,
		`Live ticker frame ${frame} changes rapidly`,
		"live-ticker",
	);
	const stable = ["Stable article A", "Stable article B"].map((text) =>
		createArticle(document, text),
	);
	return tickerLast ? [...stable, ticker] : [ticker, ...stable];
}

function createArticle(document, text, testId = "") {
	const article = document.createElement("p");
	if (testId) {
		article.dataset.testid = testId;
	}
	article.textContent = text;
	return article;
}

function withDomGlobals(callback) {
	const window = new Window({ url: "https://example.com/feed" });
	const previous = {
		Node: globalThis.Node,
		NodeFilter: globalThis.NodeFilter,
		document: globalThis.document,
	};
	Object.assign(globalThis, {
		Node: window.Node,
		NodeFilter: window.NodeFilter,
		document: window.document,
	});
	try {
		return callback(window);
	} finally {
		Object.assign(globalThis, previous);
		window.close();
	}
}

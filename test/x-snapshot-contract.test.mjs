import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const snapshotUrl = new URL("../../../pi-test/test.htm", import.meta.url);
const contentUrl = new URL("../content.js", import.meta.url);
const cssUrl = new URL("../content.css", import.meta.url);
const hasSnapshot = existsSync(snapshotUrl);

test("the saved X snapshot exposes every tweet as an atomic text unit", { skip: !hasSnapshot }, () => {
	const snapshot = readFileSync(snapshotUrl, "utf8");
	const tweetTags =
		snapshot.match(/<div\b(?=[^>]*\bdata-testid="tweetText")[^>]*>/gu) ?? [];

	assert.equal(tweetTags.length, 22);
	assert.ok(tweetTags.every((tag) => /\blang="en"/u.test(tag)));
	assert.ok(tweetTags.every((tag) => /\bdir="auto"/u.test(tag)));
});

test("the scanner uses text traversal and explicitly recognizes X tweet bodies", () => {
	const content = readFileSync(contentUrl, "utf8");

	assert.match(content, /\[data-testid='tweetText'\]/u);
	assert.match(content, /createTreeWalker\(root, NodeFilter\.SHOW_TEXT\)/u);
	assert.match(content, /const candidates = new Map\(\)/u);
	assert.match(content, /owners\.set\(node, candidate\)/u);
	assert.match(content, /serializeAssignedText\(draft\.nodes\)/u);
	assert.match(content, /pendingRoots/u);
	assert.match(content, /for \(const mutation of mutations\)/u);
	assert.match(content, /for \(const node of addedNodes\)/u);
	assert.match(content, /cleanupRemovedSubtree\(node\)/u);
	assert.doesNotMatch(content, /mutations\.some\(handleContentMutation\)/u);
	assert.doesNotMatch(content, /element\.closest\(INTERACTIVE_SELECTOR\)\) \{\s*return null/u);
	assert.doesNotMatch(content, /maxCharactersPerPage/u);
});

test("translations are plain block content placed directly after the source", () => {
	const content = readFileSync(contentUrl, "utf8");
	const css = readFileSync(cssUrl, "utf8");

	assert.match(content, /translation\.textContent = record\.translations\.join\("\\n"\)/u);
	assert.match(content, /source\.insertAdjacentElement\("afterend", translation\)/u);
	assert.match(content, /state\.elementStates\.has\(element\)/u);
	assert.match(content, /record\.rendered/u);
	assert.match(css, /display: block !important/u);
	assert.match(css, /padding: 0 !important/u);
	assert.match(css, /border: 0 !important/u);
	assert.match(css, /background: transparent !important/u);
	assert.match(css, /content: none !important/u);
});

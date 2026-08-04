import assert from "node:assert/strict";
import test from "node:test";

import { markdownText } from "../src/presentation.ts";

test("escapes hostile Markdown and HTML before rendering in Raycast Detail", () => {
	const hostile = [
		"<script>alert('xss')</script>",
		"[click me](javascript:alert(1))",
		"![image](https://tracker.invalid/pixel)",
		"`inline code` **bold** # heading",
	].join("\n");
	const markdown = markdownText(hostile);

	assert.equal(markdown.includes("<script>"), false);
	assert.equal(markdown.includes("[click me]("), false);
	assert.equal(markdown.includes("![image]("), false);
	assert.equal(markdown.includes("`inline code`"), false);
	assert.equal(markdown.includes("**bold**"), false);
	assert.equal(markdown.includes("# heading"), false);
	assert.match(markdown, /&#60;script&#62;/u);
	assert.ok(markdown.split("\n").every((line) => line.startsWith("&#8203;")));
});

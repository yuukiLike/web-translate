import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contentStyles = readFileSync(
	new URL("../../chrome-extension/content/content.css", import.meta.url),
	"utf8",
);

// 验证 X 的外层节点不参与块级布局，真实译文由可选中的内层节点承载。
test("generated 译文使用双层真实 DOM 样式", () => {
	const generatedRule = contentStyles.match(
		/\.bt-translation\.bt-translation-generated\[data-bt-owned="true"\]\s*\{([^}]*)\}/su,
	)?.[1];
	const innerRule = contentStyles.match(
		/\.bt-translation\.bt-translation-generated\[data-bt-owned="true"\]\s*>\s*\.bt-translation-inner\s*\{([^}]*)\}/su,
	)?.[1];

	assert.ok(generatedRule);
	assert.match(generatedRule, /all:\s*unset\s*!important/u);
	assert.match(generatedRule, /display:\s*inline\s*!important/u);
	assert.match(generatedRule, /inline-size:\s*auto\s*!important/u);
	assert.match(generatedRule, /margin:\s*0\s*!important/u);
	assert.doesNotMatch(generatedRule, /display:\s*block/u);
	assert.doesNotMatch(generatedRule, /inline-size:\s*100%/u);

	assert.ok(innerRule);
	assert.doesNotMatch(innerRule, /display:\s*contents/u);
	assert.match(innerRule, /white-space:\s*pre-wrap\s*!important/u);
	assert.match(innerRule, /overflow-wrap:\s*anywhere\s*!important/u);
	assert.match(innerRule, /-webkit-user-select:\s*text\s*!important/u);
	assert.match(innerRule, /(?:^|\n)\s*user-select:\s*text\s*!important/u);
	assert.match(innerRule, /pointer-events:\s*auto\s*!important/u);
	assert.match(innerRule, /cursor:\s*text\s*!important/u);
	assert.doesNotMatch(
		contentStyles,
		/\[data-bt-presentation="generated"\][^}]*::after\s*\{[^}]*content:\s*attr\(data-bt-translation\)/su,
	);
});

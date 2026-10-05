/**
 * 独立出现时无需翻译的稳定技术术语与平台名称。
 *
 * 这里只维护完整候选文本；不会从句子中删除匹配到的单词。
 * 新增条目时使用人们通常看到的写法，匹配过程不区分大小写。
 */
export const IGNORED_TRANSLATION_TERMS = Object.freeze([
	// 版本与接口标识
	"API",
	"JSON",
	"MCP",
	"OpenAPI",
	"URL",
	"v1",
	"v2",

	// 开发与平台名称
	"GitHub",
	"Linux",
	"Windows",
]);

const normalizedTerms = new Set(
	IGNORED_TRANSLATION_TERMS.map((term) => normalizeTerm(term)),
);

export function isIgnoredTranslationTerm(value) {
	return normalizedTerms.has(normalizeTerm(value));
}

function normalizeTerm(value) {
	return String(value).trim().toLocaleLowerCase("en-US");
}

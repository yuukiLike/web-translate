/**
 * 独立出现时无需翻译的稳定术语与界面短语。
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
	"bug",
	"GitHub",
	"Linux",
	"Windows",

	// 仓库状态、导航与操作标签
	"add file",
	"closed",
	"code",
	"fork",
	"main branch",
	"open",
	"star",
	"watch",
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

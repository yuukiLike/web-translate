export const READER_ARTICLE_URL =
	"https://bcantrill.dtrace.org/2026/09/05/the-revolt-of-the-reader/";

/** 保留故障页的 Hugo/AsciiDoc 结构和长文特征，正文使用原创测试文案。 */
export function mountReaderArticle(document) {
	document.documentElement.lang = "en-us";
	document.body.className = "notransition";
	document.body.innerHTML = `
		<div class="navbar" role="navigation"><nav><a href="/about/">About</a></nav></div>
		<div class="wrapper post">
			<main class="page-content" aria-label="Content"><article>
				<header class="header">
					<h1 class="header-title">An independent reader considers automated writing</h1>
					<div class="post-meta"><time itemprop="datePublished">Sep 5, 2026</time></div>
				</header>
				<div class="page-content"></div>
			</article></main>
		</div>`;
	const body = document.querySelector("article > .page-content");
	const sources = [document.querySelector("h1")];
	for (let index = 0; index < 14; index += 1) {
		const wrapper = document.createElement("div");
		wrapper.className = "paragraph";
		const paragraph = document.createElement("p");
		paragraph.append(`Section ${index + 1}: Readers discuss "authorship" and careful editing.\n`);
		const emphasis = document.createElement("strong");
		emphasis.textContent = "An article can mention an LLM or a prompt as ordinary prose. ";
		paragraph.append(emphasis);
		const link = document.createElement("a");
		link.href = "https://example.com/notes";
		link.textContent = "Reference notes";
		paragraph.append(link, " explain the distinction. ");
		paragraph.append(
			"A quoted example such as {draft} keeps its punctuation, spacing, and meaning. ".repeat(4 + index % 5),
		);
		wrapper.append(paragraph);
		body.append(wrapper);
		sources.push(paragraph);
	}
	return sources;
}

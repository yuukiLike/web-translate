# 测试过的网站

本项目曾用于排查或回归的英文网页，整理于 2026-09-07。保留原始链接，便于再次测试。

“DOM 回归”指本地模拟页面结构和翻译响应；“静态排查”指读取 HTML 或脚本。两者都不代表当前实站已通过浏览器验收。

## 网页清单

| 页面 | 测试场景 | 已有记录 |
| --- | --- | --- |
| [Dan Koe · The One-Human Business](https://letters.thedankoe.com/p/the-one-human-business-how-to-earn) | 下拉滚动漏译、长文章跳读、延后段落恢复 | 用户提供；HTML 静态排查与 [滚动回归](../test/integration/content-scroll-recovery.test.mjs)。2026-09-07 用户确认体验明显改善。 |
| [Bryan Cantrill · The Revolt of the Reader](https://bcantrill.dtrace.org/2026/09/05/the-revolt-of-the-reader/) | 长博客文章、模型返回非法 JSON 后的恢复 | 用户故障页；HTML/CSS 静态排查与 [文章回归](../test/integration/content-reader-article.test.mjs)。页面结构保留在 [fixture](../test/helpers/reader-article-fixture.mjs)，正文使用原创测试文案。 |
| [Cloudflare 首页](https://www.cloudflare.com/) | 轮播、状态文本、频繁 DOM 替换导致进度不结束 | 用户提供；2026-08-26 静态调查与 gstack 排查记录[^cloudflare]，已有 [动态内容回归](../test/integration/content-dynamic-stability.test.mjs)。 |
| [Hacker News 首页](https://news.ycombinator.com/) | 标题双语布局、来源域名与元信息、动态标题 | 2026-08-09 gstack 实页模拟翻译排查[^gstack]；已有 [DOM 回归](../test/integration/content-hacker-news.test.mjs)。 |
| [X 首页 · /home](https://x.com/home) | 悬停、正文替换、译文稳定性、停止与恢复 | [悬停回归](../test/integration/content-x-hover.test.mjs)、[替换回归](../test/integration/content-x-replacement.test.mjs) 与 [停止回归](../test/integration/content-x-stop-lifecycle.test.mjs)。 |
| [X 探索页 · /explore](https://x.com/explore) | 推文以外的主内容、趋势、链接与控件文案 | [DOM 回归](../test/integration/content-x-surfaces.test.mjs)。 |
| [Twitter 旧域名 · /home](https://twitter.com/home) | 旧域名与 X 的站点策略一致性 | [主机名边界回归](../test/integration/content-x-hover.test.mjs)；这里只确认模拟 DOM 测试。 |
| [GitHub 首页](https://github.com/) | Feed 卡片、标题链接、布局与动态内容 | [DOM 回归](../test/integration/content-github-feed.test.mjs)。 |
| [GitHub · yuukiLike](https://github.com/yuukiLike) | 贡献日历保护、图外正文与异步替换 | [DOM 回归](../test/integration/content-github-contributions.test.mjs)。 |
| [GitHub Raw · midi-js-soundfonts README](https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/044fab8e1456bfafc5776e86dfd6bb8697149aef/README.md) | 浏览器直接打开 Markdown 时的根级 `pre` 识别 | 用户提供的固定版本；2026-08-16 历史静态回归[^raw]。原专用 fixture 已移除，当前通用规则见 [纯文本回归](../test/integration/content-plain-text.test.mjs)。 |

## 记录来源

[^gstack]: 仓库本机 `.gstack/browse-audit.jsonl`，2026-08-09 的 `goto`、模拟 `chrome.runtime`、生成脚本注入与 DOM/样式检查记录。日志显示产生了译文节点，但没有完整验收断言；不能据此认定真实翻译服务测试通过。
[^cloudflare]: 2026-08-26 用户会话提供精确首页 URL；本机 `~/.gstack/projects/yuukiLike-web-translate/learnings.jsonl` 的 `dynamic-dom-progress-churn` 记录对应调查。实现边界另见 [TODO](../todo.md) 的第 0 项。
[^raw]: 2026-08-16 用户会话 `01a00aaa-9a06-7152-9843-dd3dd0f15dd2` 提供固定 SHA 链接，并记录 Raw 结构静态回归结果。原文件移除后，不把历史结果当成当前专用测试仍存在。

gstack 日志保留在本机，未随仓库提交。本表没有把样本文档的出站链接、API/CDN 地址或 `example.com` 等测试占位页算作被测网站；新增记录时注明链接、场景和验证方式即可。

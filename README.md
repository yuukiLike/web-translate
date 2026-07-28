# 一键双语翻译

零依赖的 Chrome Manifest V3 扩展。点击工具栏图标后，将当前已加载网页转换为中英段落对照；再次点击恢复原页面。

## 当前能力

- 工具栏图标或快捷键一键翻译/恢复，不使用弹窗（Windows/Linux：`Alt+Shift+B`；macOS：`Control+Shift+B`）
- 自动判断中文页或英文页，也可固定翻译方向
- 当前视口优先，译文逐批回填
- 保留原文，译文作为无标签的纯文本行紧贴显示在原文下方
- 支持普通文章、文档、表格、可见链接/按钮文案、X/Twitter 推文，以及 SPA/无限滚动新增内容
- 同批文本去重、90 天持久缓存、停止任务时取消请求
- 本月 API 用量统计
- Azure Translator、DeepL、DeepSeek V4 Flash；可随时切换 Provider 和各自的 API Key

## 安装

无需安装依赖或构建。

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录 `apps/bilingual-web-translator`。
5. 安装后会自动打开设置页，选择 Provider 并填写 API Key。
6. 建议固定扩展图标，然后在任意普通网页点击图标。

本扩展要求 Chrome 140+ 桌面版。没有配置有效 API Key 时不会翻译，也不会下载任何本地模型；点击扩展图标会直接打开设置页。

若要打开本地保存的 `pi-test/test.htm` 测试，请在扩展详情页开启“允许访问文件网址”，再刷新该本地页面。

## Provider 选择

截至 2026-07-28，建议顺序如下：

| Provider | 适用场景 | 公开免费额度或价格 |
| --- | --- | --- |
| Azure Translator F0 | 需要稳定、快速的云端专用翻译 | 每月 200 万字符免费 |
| DeepL | 更看重专用翻译质量 | 旧 API Free 每月 50 万字符；新 Developer 计划为 100 万字符总额度 |
| DeepSeek V4 Flash | 需要上下文能力且关注低价 | cache miss 输入 $0.14/M token，输出 $0.28/M token |

DeepSeek 请求固定使用 `deepseek-v4-flash`、关闭 thinking、批量发送段落，并严格校验返回 ID。旧的 `deepseek-chat` 和 `deepseek-reasoner` 不作为默认值。

本扩展不调用未经官方支持的免费 Google Translate 网页接口。此类接口没有稳定性、配额和隐私保证。

官方资料：

- [Azure Translator 限制](https://learn.microsoft.com/en-us/azure/ai-services/translator/service-limits)
- [DeepL API 限额](https://developers.deepl.com/docs/resources/usage-limits)
- [DeepL API 计划](https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans)
- [DeepL API 鉴权与域名](https://developers.deepl.com/docs/getting-started/auth)
- [DeepL 文本翻译 API](https://developers.deepl.com/api-reference/translate/request-translation)
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)

## 性能与成本策略

1. 首次用原生 `TreeWalker` 线性遍历文本节点；不使用正则解析 HTML，也不对所有元素反复递归查询。
2. 每个文本节点只归属一个翻译单元；嵌套段落、列表和 `lang` 容器不会重复翻译。X 的 `tweetText` 作为原子块，不会被内部 `span`、链接、emoji 或单字符节点拆碎。
3. `MutationObserver` 只扫描新增或实际发生文本变化的子树；180ms 节流不会因持续滚动而一直延后。高频 `class/style` 更新只检查受影响内容的可见性，不重新扫描整棵 DOM。
4. 先翻译当前视口附近内容；每轮云请求结束后重新检查滚动新增内容，使新可见正文能在旧后台批次之间插队。
5. Azure、DeepL 使用原生数组请求；DeepSeek 将多个带稳定 ID 的段落合并为一个 JSON 请求。
6. 云 API 默认并发 2，可在设置中调整为 1–4；DeepSeek 最大使用 2。
7. 相同文本批内只提交一次，成功译文按站点、Provider、模型和语言对隔离缓存。
8. 不使用累计字符硬上限阻断无限滚动；成本通过批处理、缓存和用量统计控制。
9. 对网络超时及 408、429、500、502、503、504 最多指数退避重试两次；支持秒数和 HTTP 日期格式的 `Retry-After`，超过 60 秒则提示稍后重试。

## 隐私与安全

- 使用 `activeTab`，仅在用户点击图标后取得当前标签页的临时权限。
- 云端只接收筛选后的纯文本段落，不接收网址、Cookie、表单值或整页 HTML。
- API 请求由扩展 Service Worker 发出；内容脚本无法读取 API Key。
- Key 保存在 `chrome.storage.local`，并通过 `TRUSTED_CONTEXTS` 限制内容脚本访问。
- 无痕标签页不读写翻译缓存。
- DeepSeek 输入被视为不可信数据，关闭工具和 thinking；所有返回内容只通过 `textContent` 写入页面。

浏览器端 BYOK 无法提供服务端密钥保险箱级别的保护。若要面向其他用户发布并由开发者统一承担费用，必须使用带鉴权、配额和速率限制的自有后端代理，不能把开发者 API Key 写入扩展。

## 已知边界

MVP 保证普通 HTML 页面中当前已加载的 DOM。以下内容不能保证完整翻译：

- `chrome://`、Chrome Web Store 等禁止脚本注入的页面
- Chrome 内置 PDF Viewer
- Shadow DOM（当前扫描器不跨越 shadow root）
- iframe（当前仅处理主页面 frame）
- 图片、扫描文档、视频字幕和输入框

## 本地验证

```bash
cd apps/bilingual-web-translator
node --check background.js
node --check content.js
node --check options.js
node --test test/*.test.mjs
```

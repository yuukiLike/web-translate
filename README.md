# 一键双语翻译

Chrome Manifest V3 扩展。点击工具栏图标后，把当前网页转换为中英双语对照；译文以纯文本直接显示在原文下方，再次点击恢复原页面。

当前版本：`0.4.0`。

## 当前能力

- 工具栏图标或快捷键一键翻译/恢复，不使用弹窗
- 自动判断中英文方向，也可固定翻译方向
- 当前视口优先，逐批回填译文
- 持续翻译 SPA、无限滚动和懒加载的新正文
- 处理普通文章、文档、表格、可见链接/按钮文案和 X/Twitter 推文
- 同批去重、90 天持久缓存、请求取消、有限重试和月度用量统计
- 原生支持 Azure Translator、DeepL
- 通过 Vercel AI SDK 显式支持 DeepSeek、OpenAI、Google、Anthropic
- 固定 models.dev snapshot、JSON Schema 校验和人工 Provider/API allowlist
- 右键工具栏图标可开关调试、打开详细面板并核对当前加载版本
- 脱敏调试面板实时显示批次、缓存、HTTP、重试、响应模型、结束原因和 token

## 安装与首次使用

仓库已包含生成后的 Provider bundle，普通安装不需要 npm，也不会下载任何中英本地模型。

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录 `apps/bilingual-web-translator`。
5. 首次安装会打开设置页。选择 Provider，填写你自己的 API Key。
6. 点击“测试当前服务”，成功后打开普通网页并点击扩展图标。
7. 建议把扩展固定到 Chrome 工具栏。

没有有效 API Key 时不会翻译。扩展不会要求下载模型；它把筛选后的正文段落直接发送给用户选择的云 Provider。

快捷键：

- Windows/Linux：`Alt+Shift+B`
- macOS：`Control+Shift+B`

本扩展要求 Chrome 140+ 桌面版。测试本地 `file://` 页面时，需要在扩展详情页开启“允许访问文件网址”，然后刷新页面。

## 更新本地扩展

代码或生成产物改变后，不需要删除并重新引入目录：

1. 在 `chrome://extensions` 找到扩展。
2. 点击“重新加载”。
3. 刷新正在测试的网页。
4. 再点击扩展图标。

设置页顶部、工具栏悬停 title 和图标右键菜单都会显示 Chrome 当前实际加载的版本。

## Provider 推荐

前三个推荐模型来自固定本地 snapshot。表中价格是 snapshot 记录的每 100 万 token 美元价格，不是实时报价。

| 顺序 | Provider / 模型 | 输入 / 输出 | 建议 |
| --- | --- | ---: | --- |
| 1 | DeepSeek `deepseek-v4-flash` | $0.14 / $0.28 | 默认；当前候选中最低成本，翻译时关闭 thinking |
| 2 | OpenAI `gpt-5.6-luna` | $0.20 / $1.20 | 稳定、高吞吐；翻译时显式设置 `reasoning: none` |
| 3 | Google `gemini-3.5-flash-lite` | $0.30 / $2.50 | 高吞吐；thinking 降到模型支持的 `minimal`；免费层资格可能变化 |
| 可选 | Anthropic `claude-sonnet-5` | $2.00 / $10.00 | 质量对照；翻译时显式设置 `reasoning: none` |

Azure Translator 和 DeepL 是专用翻译 API，也可以直接选择。扩展不会自动在 Provider 之间故障转移，避免在用户无感知时把正文发送给另一家公司。

模型、价格、免费层、账户权限和区域政策可能变化，以各 Provider 官方控制台为准。

## 固定模型目录架构

```text
models.dev 固定 commit
  → data/models-dev-subset.json
  → 本地 JSON Schema 校验
  → config/provider-allowlist.json
  → Vercel AI SDK 显式 Provider
  → DeepSeek / OpenAI / Google / Anthropic 官方 API
```

当前 snapshot 固定到：

```text
141191529fcad56200de45e7267a21dffcc4c33e
```

运行中的扩展不会请求 Models.dev，不接受自定义 Base URL，也没有任意 HTTPS 的可选 host permission。所有模型 Provider、SDK 包、默认模型和 API Base URL 都在构建时校验并打包。

| Provider | SDK | API Base URL |
| --- | --- | --- |
| DeepSeek | `@ai-sdk/deepseek` | `https://api.deepseek.com` |
| OpenAI | `@ai-sdk/openai` | `https://api.openai.com/v1` |
| Google | `@ai-sdk/google` | `https://generativelanguage.googleapis.com/v1beta` |
| Anthropic | `@ai-sdk/anthropic` | `https://api.anthropic.com/v1` |

详细更新流程见 [固定模型目录与 Provider 架构](docs/provider-catalog.md)。

## Azure Translator 的“资源区域”

资源区域是 Azure 用来识别和路由订阅资源的创建区域，不是源语言或目标语言。

- Translator 单服务全局资源通常可以留空。
- 区域性 Translator 资源必须填写区域。
- Azure AI 多服务或 Foundry 资源通常必须填写区域。
- 值必须与 Azure 门户资源页面一致，例如 `eastasia`；不一致常导致 `401` 或 `403`。

以 [Azure Translator 鉴权文档](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/authentication) 为准。

## 调试模式

右键扩展图标勾选“开发调试模式”，再选择“打开详细调试面板”。设置页也可以开启“记录调试事件”并保存。

面板可以看到：

- 扩展版本、models.dev snapshot SHA、Service Worker 实例
- Provider、模型、显式 SDK adapter、固定 API host 和低推理策略
- 批次段落数、字符数、缓存命中/未命中
- HTTP endpoint、状态、耗时、超时、尝试次数和退避等待
- Provider 响应 ID、实际响应模型、标准/原始结束原因和警告数量
- 输入、输出、cache read、cache write、no-cache token 或计费字符

调试事件采用严格字段白名单，绝不保存：

- API Key、Authorization 或其他请求头
- query token、请求体、响应体或完整 Provider 错误原文
- 网页原文、译文、Cookie、表单值或整页 HTML

事件只位于 `chrome.storage.session`，最多 300 条且约 512 KiB。完整字段、事件顺序和故障诊断见 [调试模式与请求诊断](docs/debugging.md)。

## 插件数据流

```text
网页 DOM
  → content.js：TreeWalker 筛选、去重、分批、监听新增 DOM
  → background.js：固定任务设置、缓存、限流/重试、Provider 调用
  → Provider API：返回译文和用量
  → background.js：校验结束原因、JSON、段落 ID、数量和长度
  → content.js：通过 textContent 把译文插入原文下方
```

主要文件：

- `manifest.json`：Manifest V3 入口、action、设置页和固定权限
- `lib/provider-catalog.generated.js`：只读的本地 Provider/模型目录
- `lib/core.js`：设置规范化、语言判断、分批、缓存签名和模型 JSON 校验
- `content.js`：DOM 遍历、视口优先、增量监听和双语渲染
- `background.js`：API Key、任务、缓存、重试、用量和安全调试事件
- `src/provider-runtime.js`：四个显式 Vercel AI SDK Provider 的统一源代码
- `lib/provider-runtime.js`：供 Service Worker 使用的生成 bundle
- `options.*`：Provider 设置、本地目录、用量和调试界面

第一次开发 Chrome 插件建议阅读 [Chrome 扩展开发入门](docs/chrome-extension-basics.md)。

## 性能与成本策略

1. 首次使用原生 `TreeWalker` 线性遍历文本节点，不用正则解析 HTML。
2. `MutationObserver` 只扫描新增或真正变化的子树，支持无限滚动。
3. 当前视口附近内容优先，云请求之间重新检查新可见正文。
4. 同批文本去重；缓存按站点、Provider、模型、协议版本和语言对隔离。
5. Azure/DeepL 使用数组请求；模型 Provider 把多个稳定 ID 段落合并为一个 JSON 任务。
6. 默认并发 2；模型 Provider 最大并发 2，Azure/DeepL 最大并发 4。
7. SDK 内部重试关闭，后台统一处理超时和最多三次尝试，避免双重重试成本。
8. DeepSeek 关闭 thinking，OpenAI 和 Anthropic 设置 `reasoning: none`；Gemini 3.5 使用其支持的最低 `minimal` thinking，减少延迟和推理 token。
9. Provider runtime 生产 bundle 已压缩，并预设 Zod `jitless`，避免触发 Manifest V3 CSP 禁止的动态代码探测。

## 隐私与安全

- `activeTab` 只在用户点击图标后临时访问当前标签页。
- 云端只接收筛选后的纯文本段落，不接收网址、Cookie、输入框或整页 HTML。
- API 请求由 Service Worker 发出；内容脚本不能读取 API Key。
- Key 保存在本机 `chrome.storage.local`，访问级别限制为 `TRUSTED_CONTEXTS`。
- 无痕标签页不读写持久翻译缓存。
- Provider 返回值只通过 `textContent` 写入网页。
- 所有可执行 JavaScript 随扩展打包，不从网络下载代码。

浏览器端 BYOK 不是服务端密钥保险箱。若面向他人发布并由开发者统一付费，应使用带鉴权、配额和速率限制的自有后端代理，不能把开发者 Key 写进扩展。

## 已知边界

- `chrome://`、Chrome Web Store 等禁止注入的页面
- Chrome 内置 PDF Viewer
- Shadow DOM
- iframe（当前只处理主 frame）
- 图片、扫描文档、视频字幕和输入框

## 开发与验证

普通用户无需执行本节。修改 snapshot、SDK 依赖或 Provider runtime 时需要 Node.js 22+：

```bash
cd apps/bilingual-web-translator
npm install --ignore-scripts
node scripts/validate-provider-config.mjs
node scripts/build-provider-runtime.mjs
npm run check
```

`npm run check` 不调用真实 Provider，不需要 API Key；它还会在内存中重新生成 bundle，并拒绝过期的 `lib/` 产物。

## 官方资料

- [Chrome 扩展入门](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- [Chrome Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Models.dev 源码与数据](https://github.com/anomalyco/models.dev)
- [Vercel AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [OpenAI 模型](https://developers.openai.com/api/docs/models)
- [Google Gemini 模型](https://ai.google.dev/gemini-api/docs/models)
- [Anthropic API](https://docs.anthropic.com/en/api/overview)

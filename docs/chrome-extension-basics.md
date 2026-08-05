# Chrome 扩展开发入门：以“一键双语翻译”为例

本文面向第一次接触 Chrome 扩展开发的读者。你会先在 10–15 分钟内加载并运行现有扩展，再理解 Manifest V3 的运行上下文、权限和调试方法。

本文讨论项目根目录中的 Chrome 包：

```text
chrome-extension/
```

仓库已经包含 Chrome 可直接加载的生成产物，因此只想安装和体验扩展时，不需要安装依赖或执行构建。参与开发、修改模型目录、Vue 设置页或 Provider runtime 前，则需要在 `web-translate` 仓库根目录准备 Node 依赖并重新生成产物。当前 `chrome-extension/manifest.json` 声明的扩展版本是 `0.4.0`，最低 Chrome 版本是 140。

## 阅读路线

| 你的目标 | Diataxis 类型 | 阅读位置 |
| --- | --- | --- |
| 第一次看到扩展工作 | 教程 | 第 1 部分 |
| 理解 Manifest V3 为什么这样拆分 | 解释 | 第 2 部分 |
| 正确加载、重新加载和使用 DevTools | 操作指南 | 第 3 部分 |
| 查询清单、权限和文件职责 | 参考 | 第 4 部分 |
| 定位故障并守住安全边界 | 操作指南与解释 | 第 5 部分 |

---

## 第 1 部分：10–15 分钟看到第一次结果（教程）

完成本节后，你会看到设置页中的运行时版本，配置自己的翻译服务，并在普通网页上通过左键点击扩展图标切换双语翻译。

### 准备条件

- Chrome 140 或更高版本的桌面浏览器。
- 已在 `web-translate` 仓库根目录中找到 `chrome-extension/`。
- 一个由你自己申请的受支持 Provider API Key。不要把 Key 写进代码、截图、文档或提交记录。
- 一个普通的 `https://` 或 `http://` 中英文网页。不要用 `chrome://` 页面、Chrome Web Store 或内置 PDF Viewer 做第一次测试。

### 可选：首次准备开发环境

如果你只是加载仓库中已经生成好的扩展，请跳过本节，直接进入步骤 1。

如果你要修改 `src/provider-runtime.js`、`src/options/`、固定模型 snapshot、Provider allowlist 或对应 schema，请使用 Node.js 24。仓库根目录的 `.nvmrc` 记录当前版本。随后在仓库根目录运行：

```bash
npm install --ignore-scripts
npm run build:chrome
```

第一条命令安装构建依赖，但不运行依赖包的生命周期脚本；第二条命令先校验 snapshot、schema 和 allowlist，再生成 `chrome-extension/generated/` 中的 Provider 文件，并把 Vue 设置页编译到 `chrome-extension/options/`。这些生成文件已经随仓库提供，因此普通安装者无需重复构建。

### 步骤 1：加载目录

1. 在地址栏手动输入 `chrome://extensions`。
2. 打开右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择下面这个目录，而不是它的父目录，也不是单独的 `manifest.json`：

   ```text
   <web-translate 仓库>/chrome-extension
   ```

Chrome 会把 `chrome-extension/` 根部的 `manifest.json` 当作扩展入口。

如果此前加载的是 `web-translate` 仓库根目录，目录重构后需要删除旧条目并重新选择 `chrome-extension/`。Chrome 可能为新路径生成不同的未打包扩展身份，旧设置和 API Key 因此可能不会自动迁移；重新填写一次即可。之后的代码更新仍只需在扩展卡片上点击“重新加载”。

### 步骤 2：确认第一个可见结果

首次安装后，设置页会自动在新标签页中打开。页面顶部应显示：

```text
一键双语 · web translate
配置 · 调试 · v0.4.0
```

这已经证明三件事：扩展包加载成功、Service Worker 的安装事件执行成功、设置页能通过 `chrome.runtime.getManifest()` 读取当前已加载版本。

如果设置页没有自动打开，先把扩展固定到工具栏，再右键扩展图标并选择“打开详细调试面板”。重新加载一个已安装的扩展不会再次触发“首次安装时打开设置页”的分支。

### 步骤 3：配置你自己的翻译服务

1. 在“服务”中选择 DeepSeek、OpenAI、Google Gemini、Anthropic、Azure Translator、DeepL 或自定义 OpenAI-compatible 服务。DeepSeek 是默认项。
2. 只在密码输入框中填写你自己的 API Key。
3. 固定模型 Provider 默认使用本地 allowlist 模型，通常无需展开模型选项。只有选择“自定义”时才需要填写 Base URL 和模型 ID；保存或测试时 Chrome 会为该 API origin 请求可选访问权限。
4. 点击“保存并测试”。
5. 等待页面显示“连接成功”。

不要在本文、源代码或聊天中使用真实 Key 作为示例。若没有有效 Key，左键点击扩展图标时，扩展会显示 `SET` 徽标并打开设置页，不会执行翻译。

### 步骤 4：左键一键翻译，再次点击恢复

1. 打开一个普通文章页面。
2. 左键点击“一键双语翻译”的工具栏图标。
3. 观察页面右下角状态提示和图标徽标。正文会按当前视口优先分批翻译，译文以纯文本显示在原文下方。
4. 等待徽标显示 `OK`。
5. 再次左键点击同一个图标。当前运行插入的译文和状态节点会被移除，页面恢复原状。

这里没有弹窗。项目没有声明 `action.default_popup`，因此左键触发 `chrome.action.onClicked`。后台先注入 `content/content.css`，再按顺序注入 `generated/provider-catalog.js`、`shared/core.js` 和 `content/content-script.js`。第二次注入时，页面中已有的内容脚本控制器会执行“停止并恢复”。模型 SDK 的 `generated/provider-runtime.js` 只由 Service Worker 加载，不会进入网页内容脚本。

也可以使用快捷键触发相同动作：

- Windows/Linux：`Alt+Shift+B`
- macOS：`Control+Shift+B`

### 步骤 5：用右键菜单看一次脱敏调试事件

1. 右键扩展工具栏图标。
2. 勾选“开发调试模式”。这个菜单项会立即保存开关状态。
3. 再次右键，选择“打开详细调试面板”。
4. 回到网页触发一次翻译，或在设置页点击“保存并测试”。
5. 在“调试模式”区域观察 `batch.received`、`cache.resolved`，以及当前服务对应的请求事件。Azure 和 DeepL 使用 `request.*`；四个模型 Provider 使用 `model.request.*`、`sdk.request-*` 和 `model.response.validated`。
6. 测试结束后取消勾选“开发调试模式”，或在设置页关闭“记录事件”；两处都会立即保存。

内置面板只显示安全字段，例如 Provider、模型、请求方法、脱敏后的端点、HTTP 状态、耗时、字符数和 token 数。它不显示 API Key、请求头、正文、译文、请求体或响应体。

### 你刚刚完成了什么

你已经走通了完整链路：

```text
左键 action
  → Service Worker 获得当前标签页
  → 动态注入内容脚本
  → 内容脚本读取并筛选 DOM 文本
  → 消息传给 Service Worker
  → Service Worker 携带本机 Key 请求 Provider
  → 内容脚本用 textContent 插入译文
```

下一步应阅读第 2 部分，理解为什么密钥、DOM 和网络请求被放在不同运行上下文中。

---

## 第 2 部分：Manifest V3 架构（解释）

### 2.1 先建立“多个运行上下文”的模型

Chrome 扩展不是一个一直运行的网页。当前项目由三个主要运行上下文组成：

```text
普通网页                                  扩展自己的安全源
┌─────────────────────┐                 ┌──────────────────────────┐
│ content-script.js   │  一次性消息      │ service-worker.js         │
│ - 读取/修改 DOM      │ ───────────────→ │ - Service Worker          │
│ - 不持有 API Key     │ ←─────────────── │ - 读取 Key、缓存和用量      │
└─────────────────────┘  结果/状态        │ - 请求 Provider API        │
                                          └────────────┬─────────────┘
                                                       │ 消息与 Port
                                          ┌────────────▼─────────────┐
                                          │ options/index.html       │
                                          │ Vue options bundle       │
                                          │ - 本地目录、设置、用量      │
                                          │ - 脱敏实时调试面板         │
                                          └──────────────────────────┘
```

这种拆分不是文件分类习惯，而是安全边界：内容脚本能接触不可信网页；Service Worker 持有高权限能力；设置页是扩展自己的受信任界面。它们不能直接共享普通 JavaScript 变量，只能通过消息或存储协作。

### 2.2 `manifest.json`：声明能力，不承载业务逻辑

每个扩展根目录都必须有 `manifest.json`。它告诉 Chrome：

- 这是 Manifest V3 扩展，名称和版本是什么。
- 后台入口是哪个 Service Worker。
- 工具栏 action、快捷键和设置页如何注册。
- 扩展请求哪些 Chrome API 权限和站点权限。
- 哪个 Chrome 版本起才允许安装。

当前项目的几个“没有声明”同样重要：

- 没有 `action.default_popup`，所以左键事件交给 `chrome.action.onClicked`，不会打开弹窗。
- 没有 `content_scripts`，所以不会在所有匹配网页启动时自动注入；只在用户触发 action 后动态注入。
- 没有显式 `content_security_policy`，所以扩展页和 Service Worker 使用 Manifest V3 默认策略。

### 2.3 `action`：左键是产品主动作

`action` 表示工具栏上的扩展入口。`default_title` 提供初始悬停提示；后台还会通过 `chrome.action.setTitle()` 把运行时版本和调试状态写入提示，并通过徽标显示：

- `SET`：需要配置 API Key，或本地模型配置未通过 allowlist 检查。
- `ERR`：页面不可注入或发生错误。
- `0`–`99`：翻译进度百分比。
- `OK`：当前页面翻译完成。

右键不是另一种 `action.onClicked`。项目使用 `chrome.contextMenus`，并把三个菜单项限制在 `contexts: ["action"]`：切换开发调试、打开详细调试面板、显示当前版本。

### 2.4 Service Worker：事件驱动的后台协调者

`chrome-extension/manifest.json` 将 `background/service-worker.js` 注册为模块型 Service Worker：

```json
"background": {
  "service_worker": "background/service-worker.js",
  "type": "module"
}
```

Service Worker 没有页面 DOM，也不是永久进程。Chrome 会在 action 点击、消息、安装事件或 Port 连接等事件到达时唤醒它，并可能在空闲后终止它。因此：

- 事件监听器必须在文件顶层同步注册。当前代码在顶层注册 `onInstalled`、`action.onClicked`、`contextMenus.onClicked`、`runtime.onMessage` 和 `runtime.onConnect`。
- 不能把必须长期存在的数据只放在全局变量中。当前项目把设置、缓存和用量放进 `storage.local`，把运行快照、缓存代次和调试事件放进 `storage.session`。
- 内存对象仍可用于当前活跃周期，例如进行中的 `AbortController`；但设计不能假定它永远存在。

当前后台还承担配置与模型 allowlist 检查、输入验证、批处理、缓存、超时、重试、用量统计和 Provider 响应校验。Azure Translator 与 DeepL 使用后台中的专用 REST 调用；DeepSeek、OpenAI、Google 和 Anthropic 通过打包到 `generated/provider-runtime.js` 的 Vercel AI SDK 适配器调用固定官方 API；自定义 OpenAI-compatible 服务复用同一包内运行时，并且必须先获得对应 origin 的可选权限。把跨域请求放在这里，而不是内容脚本里，可以让 API Key 留在扩展受信任上下文，并由 host permission 控制访问目标。

### 2.5 Content script：能碰 DOM，但处在隔离世界

内容脚本运行在网页上下文中，可以读取和修改共享 DOM，但它的 JavaScript 全局环境与网页自身脚本隔离。网页脚本不能直接读取 `content/content-script.js` 中的局部变量；两者仍然会看到对同一 DOM 的修改。

本项目使用 `chrome.scripting` 动态注入：

1. `content/content.css` 定义译文和状态节点样式。
2. `generated/provider-catalog.js` 在隔离世界中提供冻结的本地 Provider 与模型目录。
3. `shared/core.js` 基于该目录建立设置和纯函数工具。
4. `content/content-script.js` 遍历文本节点、选择翻译单元、发送批次并插入译文。

注入目标只给出 `tabId`，因此默认只处理主 frame。当前实现也不穿越 Shadow DOM。这解释了为什么 iframe 和某些 Web Component 内容不会被完整翻译。

内容脚本把 Provider 返回值当作不可信数据，最终只通过 `textContent` 写入页面，不把返回文本当 HTML 执行。

### 2.6 Options page：扩展自己的设置与诊断界面

`options_ui.page` 指向 `options/index.html`，`open_in_tab: true` 表示设置页在独立标签页打开。`chrome.runtime.openOptionsPage()` 会打开或聚焦它。页面源码位于 `src/options/`，通过 Vue 构建为包内的 `options/options.js` 与 `options/options.css`。

设置页负责：

- 读取和保存 Provider、API Key、模型、翻译方向及并发数。
- 从包内 `generated/provider-catalog.js` 呈现固定 Provider、模型、成本和上下文信息。
- 测试连接、读取用量和清理缓存。
- 通过长连接 Port 接收脱敏实时调试事件。

设置页不会联网刷新模型目录。固定 Provider 的 Base URL 与模型仍来自 allowlist；只有单独的自定义 Provider 提供 Base URL 与模型 ID 输入，并按 origin 请求可选权限。目录来源 commit 和 snapshot 抓取时间只是本地产物中的元数据；更新固定目录必须修改仓库数据、通过 schema/allowlist 校验、重新构建并重新加载扩展。

设置页是受信任扩展页面，可以读取完整设置。普通网页中的内容脚本只能从 `START_RUN` 响应拿到 `publicSettings()` 返回的非敏感字段。

### 2.7 Storage：持久数据与会话数据分开

| 区域 | Chrome 生命周期 | 本项目存放内容 | 内容脚本访问 |
| --- | --- | --- | --- |
| `chrome.storage.local` | 保留到扩展被卸载 | 设置与 API Key、翻译缓存、月度用量 | 后台显式设为 `TRUSTED_CONTEXTS`，禁止内容脚本读取 |
| `chrome.storage.session` | 内存保存；扩展停用、重新加载、更新或浏览器重启时清空 | 运行快照、缓存代次、脱敏调试事件 | 默认不暴露，项目也显式设为 `TRUSTED_CONTEXTS` |

`storage.local` 不是密钥保险箱。它避免把 Key 暴露给普通内容脚本，但拥有本机 Chrome 配置访问权的人、扩展自身受信任页面以及被攻陷的扩展代码仍可能读取它。

### 2.8 Message passing：跨上下文的明确接口

Chrome 提供两种主要通信方式：

- `runtime.sendMessage()` / `runtime.onMessage`：一次请求、一次响应。本项目的大部分命令使用这种方式。
- `runtime.connect()` / `runtime.onConnect`：可重复发送消息的长连接。本项目的设置页用名为 `debug-events-v1` 的 Port 接收实时事件，并定期发送心跳。

当前消息流的关键约束是：

- 来自网页的消息必须带有有效 `sender.tab.id`。
- 读取完整设置、调试事件和用量等操作必须来自 `chrome-extension://` 设置页。
- 后台验证消息类型、任务 ID、语言、段落数量、总字符数和译文长度。
- 内容脚本不能指定任意请求 URL；Provider URL由后台根据已保存设置构造。

这符合 Chrome 的安全建议：把内容脚本视为较低信任级别，验证它发来的所有数据，并限制它能触发的高权限操作。

### 2.9 `activeTab` 与 host permissions：两类“访问站点”不要混淆

| 权限 | 访问对象 | 获得时机 | 当前用途 |
| --- | --- | --- | --- |
| `activeTab` | 用户当前网页 | 左键 action、快捷键等明确用户手势后临时获得；导航到其他 origin 或关闭标签页后撤销 | 配合 `scripting` 向当前网页注入 CSS 和内容脚本 |
| `host_permissions` | 六类固定 Provider 的七个 API origin | 安装时随清单声明 | 允许扩展 Service Worker 请求固定 Provider |
| `optional_host_permissions` | 用户填写的自定义 OpenAI-compatible origin | 保存或测试自定义服务时，由 Chrome 明确询问 | 只允许请求用户选择并授权的自定义 API |

网页权限和 API 权限是两条独立边界。`activeTab` 不会自动允许请求 Provider；API host permission 也不会让扩展永久读取所有网页。

固定 Provider 的域名都在 `host_permissions` 中精确列出。清单另外声明 `https://*/*`、`http://localhost/*` 和 `http://127.0.0.1/*` 为可选范围，但不会在安装时获得它们；只有用户选择“自定义”、填写有效地址并保存或测试时，设置页才会通过 `chrome.permissions.request()` 请求该 origin。拒绝授权就不会发起请求。

### 2.10 CSP：允许远程数据，不允许远程代码

Manifest V3 扩展页的默认 Content Security Policy 等价于：

```text
script-src 'self'; object-src 'self';
```

因此 `options/index.html` 只加载包内的 `generated/provider-catalog.js`、`shared/core.js` 和 `options/options.js`；Service Worker 也只导入包内代码。Vue、Vercel AI SDK 及 Provider 适配器在开发阶段由 esbuild 打包成本地文件，运行时不会从 npm 或 CDN 加载代码。不要改成 CDN 脚本、`eval()` 或把网络响应当 JavaScript 执行。

固定模型 snapshot 与 allowlist 是包内数据，构建前由 JSON Schema 和交叉约束校验，并被生成到本地目录脚本中。扩展运行时不请求 Models.dev，也不维护远程目录缓存；网络只用于向当前 Provider 发送翻译或连接测试。Provider 返回值仍会经过结构、ID、数量和长度校验。

---

## 第 3 部分：开发与调试操作（操作指南）

### 3.1 如何正确加载与重新加载

首次加载使用：

```text
chrome://extensions
  → 开发者模式
  → 加载已解压的扩展程序
  → <web-translate 仓库>/chrome-extension
```

上面的安装流程直接使用仓库中的生成产物。修改固定目录或模型 SDK 运行时的开发者，需要先执行：

```bash
npm run build:chrome
```

如果这是首次准备该目录，使用 Node.js 24 并先执行 `npm install --ignore-scripts`。构建成功会生成 `chrome-extension/generated/` 与 `chrome-extension/options/` 产物；随后仍需在 Chrome 中重新加载扩展。

之后修改文件时，不需要删除后重新选择目录。根据修改位置执行：

| 修改文件 | 需要重新加载扩展 | 还需要刷新页面 |
| --- | --- | --- |
| `chrome-extension/manifest.json` | 是 | 视测试目标而定 |
| `chrome-extension/background/service-worker.js` | 是 | 通常重新触发动作即可；为避免旧上下文干扰，建议刷新测试网页 |
| `chrome-extension/content/` | 是 | 是。旧内容脚本已进入页面，必须刷新宿主网页再点击图标 |
| `chrome-extension/generated/provider-catalog.js`、`chrome-extension/shared/core.js` | 是 | 是。它们同时被 Service Worker、内容脚本和设置页使用 |
| `chrome-extension/generated/provider-runtime.js` | 是 | 建议刷新测试网页；它只在 Service Worker 中执行 |
| `chrome-extension/options/` | Chrome 官方流程不要求重新加载整个扩展 | 重新构建后刷新设置页标签 |

以下是“源文件”，Chrome 不会直接使用它们：

- `data/models-dev-subset.json`
- `config/provider-allowlist.json`
- `schemas/*.schema.json`
- `src/provider-runtime.js`
- `src/options/`

修改这些文件后必须先重新运行构建脚本，再重新加载扩展。不要直接编辑 `chrome-extension/generated/` 中的 Provider 文件或 `chrome-extension/options/options.js`、`chrome-extension/options/options.css`；下一次构建会覆盖手工修改。`npm run check` 会重新计算预期产物并拒绝过期 bundle；构建器还会预设 Zod `jitless`，避免在 Manifest V3 CSP 下尝试动态代码生成。

最稳妥的开发循环是：

1. 保存文件。
2. 在 `chrome://extensions` 的扩展卡片上点击“重新加载”按钮。
3. 刷新测试网页。
4. 再次左键点击扩展图标。

不要只刷新网页来测试新的 Service Worker，也不要只重新加载扩展却保留已经注入旧内容脚本的网页。

### 3.2 如何核对当前运行版本

先区分两个值：

- 源码期望版本：`chrome-extension/manifest.json` 中的 `version`。
- Chrome 实际加载版本：运行中的扩展上下文通过 `chrome.runtime.getManifest().version` 读到的值。

当前两者都应是 `0.4.0`。可以从四处核对运行版本：

1. 设置页顶部的 `v0.4.0`。
2. 鼠标停在工具栏图标上，查看含版本号的 title。
3. 右键图标，查看不可点击的“当前版本 v0.4.0”菜单项。
4. 打开 Service Worker DevTools，在 Console 执行：

   ```js
   chrome.runtime.getManifest().version
   ```

如果源码和运行版本不一致，回到 `chrome://extensions` 重新加载。仍不一致时，确认扩展卡片显示的“扩展程序路径”正是本项目目录，避免同时加载了另一份副本。

### 3.3 如何打开 Service Worker DevTools

1. 打开 `chrome://extensions`。
2. 找到“一键双语翻译”。
3. 在“检查视图”或 Service Worker 一行点击蓝色的 `service worker` 链接。
4. 在打开的 DevTools 中使用：
   - Console：后台初始化、消息处理和未捕获错误。
   - Sources：给 `background/service-worker.js` 设置断点。
   - Network：查看由 Service Worker 发出的 Provider 请求。
   - Application：查看 Service Worker 状态和 Extension Storage。

若显示 `inactive`，这通常不是故障。点击链接或触发一次 action 会唤醒 Worker。注意：打开 Worker DevTools 会让它保持活跃；验证“休眠后能否恢复”时必须关闭 DevTools 再测试。

如果 Worker 在初始化阶段就注册失败，可能无法打开 DevTools。此时查看扩展卡片上的“错误”按钮，先修复首个注册或语法错误，再重新加载。

### 3.4 如何调试网页中的内容脚本

1. 在已经触发过翻译的普通网页上打开网页 DevTools。
2. 在 Console 顶部的执行上下文下拉框中，从 `top` 切换到该扩展的内容脚本上下文。
3. 在 Sources 中找到注入的 `content/content-script.js` 并设置断点。
4. 在 Elements 中检查：
   - 原文节点上的 `data-bt-source`。
   - 扩展插入的 `.bt-translation[data-bt-owned="true"]`。
   - 右下角 `.bt-status[data-bt-owned="true"]`。
5. 可在网页 Console 中做只读检查：

   ```js
   document.querySelectorAll('.bt-translation[data-bt-owned="true"]').length
   ```

内容脚本错误出现在网页 DevTools，而不是一定出现在 `chrome://extensions` 的错误列表中。Provider 请求则由 `background/service-worker.js` 发起，应到 Service Worker DevTools 查 Network。

### 3.5 如何调试设置页

1. 右键扩展图标，选择“打开详细调试面板”。
2. 在设置页标签中打开普通 DevTools。
3. 用 Console 调试构建后的 `options/options.js`，用 Vue 源码定位 `src/options/`，并用 Network 区分设置页自身资源和后台请求。
4. 在 Application > Storage > Extension Storage 中可查看 `local` 和 `session`。

Extension Storage 面板从 Chrome 132 起可用，本项目最低要求 Chrome 140，因此可以直接使用。不要在录屏、截图或共享会话中展开包含 `settings` 的 `storage.local`：其中可能有真实 API Key。

### 3.6 如何查看网络请求而不误判上下文

Provider 请求可能在你打开 DevTools 前就结束。建议按这个顺序：

1. 先打开 Service Worker DevTools 的 Network。
2. 开启 Preserve log。
3. 清空现有记录。
4. 回到设置页点击“保存并测试”，或在网页触发翻译。
5. 按当前 Provider 的 API host 过滤，或查找 `translate`、`chat/completions`、`responses`、`messages`、`generateContent` 等请求路径。
6. 先看 Status、Initiator 和 Timing，再决定是否查看 Headers、Payload 或 Response。

Network 面板不会替你脱敏。Headers 可能含 `Authorization`，Payload 和 Response 可能含网页正文及译文。不要截图、复制为 cURL、导出带敏感数据的 HAR，或把这些内容贴到 issue 和聊天中。日常排错优先使用项目内置的脱敏调试面板。

### 3.7 如何读项目内置调试事件

| 事件 | 含义 | 下一步 |
| --- | --- | --- |
| `batch.received` | 后台已收到一批经过验证的段落 | 若没有后续事件，检查缓存或后台异常 |
| `cache.resolved` | 缓存查找结束 | 看 `cacheHits` 与 `cacheMisses`；全命中时没有 Provider 请求是正常的 |
| `request.started` | 即将发起一次 API 尝试 | 用 `endpoint`、`method`、`attempt` 确认目标，不需要正文即可定位链路 |
| `request.completed` | API 返回并通过当前层校验 | 看 HTTP 状态和耗时 |
| `request.failed` | 请求失败、超时或被取消 | 看 `errorCode`、`httpStatus`、`retryable` 和 `cancelled` |
| `request.retry-scheduled` | 已安排退避重试 | 看 `retryAfterMs`，不要立刻重复点击造成更多请求 |
| `model.request.started` / `model.request.completed` | 一次模型 SDK 尝试开始或完成 | 用 Provider、模型、adapter、attempt、timeout 和总耗时确认模型层生命周期 |
| `model.request.failed` / `model.request.retry-scheduled` | 模型 SDK 尝试失败或安排重试 | 看 HTTP 状态、安全错误码、是否可重试及等待时间 |
| `sdk.request-start` / `sdk.request-end` / `sdk.request-error` | SDK 内部实际 HTTP 请求开始、结束或网络失败 | 看脱敏端点、方法、HTTP 状态和 SDK HTTP 耗时；它们位于一次 `model.request.*` 尝试内部 |
| `model.response.validated` | SDK 响应元数据已提取，且模型完成原因通过检查 | 可查看响应 ID、响应模型、结束原因、警告数和输入/输出/缓存 token；不含响应正文 |
| `provider.usage` | Provider 返回的用量已提取 | 核对 token 或计费字符是否符合预期 |
| `batch.completed` / `batch.failed` | 整批完成或失败 | 与同一 `runId` 的前序事件串联查看 |

调试事件保存在 `chrome.storage.session` 的有界缓冲区中，最多 300 条且约 512 KiB。重新加载扩展、停用扩展、更新扩展或重启浏览器会清空 session 区域。也可以在设置页点击“清空事件”。

---

## 第 4 部分：项目参考

### 4.1 文件到 Chrome 概念的映射

| 文件 | 运行上下文 | Chrome 概念 | 当前职责 |
| --- | --- | --- | --- |
| [`chrome-extension/manifest.json`](../chrome-extension/manifest.json) | Chrome 扩展平台 | Manifest V3 | 声明版本、最低 Chrome 版本、Service Worker、action、快捷键、设置页与权限 |
| [`package.json`](../package.json) | Node 开发环境 | 构建依赖与脚本 | 固定 Vercel AI SDK Provider 包、`ai`、esbuild、AJV 版本及校验/构建命令；不是扩展清单 |
| [`data/models-dev-subset.json`](../data/models-dev-subset.json) | 构建输入 | 固定数据 snapshot | 保存四个 Provider 的模型元数据及可追溯的来源 commit，不在扩展运行时联网刷新 |
| [`config/provider-allowlist.json`](../config/provider-allowlist.json) | 构建输入 | Provider allowlist | 固定四个 SDK 包、官方 API Base URL、默认模型和默认 Provider |
| [`schemas/model-catalog.schema.json`](../schemas/model-catalog.schema.json)、[`schemas/provider-allowlist.schema.json`](../schemas/provider-allowlist.schema.json) | Node 开发环境 | JSON Schema | 约束 snapshot 与 allowlist 的结构和允许值 |
| [`scripts/validate-provider-config.mjs`](../scripts/validate-provider-config.mjs) | Node 开发环境 | 构建前校验 | 用 schema 和交叉约束校验四个 Provider、来源 commit、SDK 包、官方 Base URL 与默认模型 |
| [`scripts/build-provider-runtime.mjs`](../scripts/build-provider-runtime.mjs) | Node 开发环境 | 生成与打包 | 生成本地目录脚本，并用 esbuild 将 Provider SDK 运行时打包为 Chrome 140 可执行代码 |
| [`src/provider-runtime.js`](../src/provider-runtime.js) | 构建输入 | Vercel AI SDK 适配层 | 创建四家固定模型和自定义 OpenAI-compatible 模型，采集 SDK HTTP 与响应元数据 |
| [`src/options/`](../src/options/) | 构建输入 | Vue 设置页源码 | 最短配置路径、Provider 字段、用量与调试界面 |
| [`chrome-extension/generated/provider-catalog.js`](../chrome-extension/generated/provider-catalog.js) | Worker、内容脚本、设置页都会加载 | 包内生成数据 | 提供深度冻结的固定 Provider 和模型目录；不要手工编辑 |
| [`chrome-extension/generated/provider-runtime.js`](../chrome-extension/generated/provider-runtime.js) | Extension Service Worker | 包内生成代码 | 包含 Vercel AI SDK 与 Provider 适配器；不要手工编辑，也不注入网页 |
| [`chrome-extension/background/service-worker.js`](../chrome-extension/background/service-worker.js) | Extension Service Worker | `background.service_worker`、事件、跨域请求 | 左键入口、右键菜单、消息路由、allowlist 检查、Key、缓存、Provider 请求、重试、用量和脱敏事件 |
| [`chrome-extension/shared/core.js`](../chrome-extension/shared/core.js) | Worker、内容脚本、设置页都会加载 | 包内共享代码 | 设置规范化、Provider 定义、语言判断、分批、缓存签名和模型 JSON 校验 |
| [`chrome-extension/content/content-script.js`](../chrome-extension/content/content-script.js) | 网页中的隔离世界 | 动态 content script | 扫描 DOM、视口优先调度、监听动态内容、发消息、用 `textContent` 插入和移除译文 |
| [`chrome-extension/content/content.css`](../chrome-extension/content/content.css) | 注入到当前网页 | `scripting.insertCSS()` | 译文和状态节点样式；使用 `data-bt-owned` 限定扩展节点 |
| [`chrome-extension/options/index.html`](../chrome-extension/options/index.html) | `chrome-extension://` 页面 | Options page | 加载包内目录、共享核心和 Vue bundle |
| [`chrome-extension/options/options.js`](../chrome-extension/options/options.js) | 受信任扩展页面 | Vue bundle、消息、Port | 保存设置、测试连接并渲染用量和脱敏事件；不要手工编辑 |
| [`chrome-extension/options/options.css`](../chrome-extension/options/options.css) | 受信任扩展页面 | Extension page UI | 编译后的设置页样式；不要手工编辑 |
| [`test/`](../test/) | Node 测试环境 | 行为契约 | 验证消息边界、脱敏、目录过滤、DOM 增量更新、去重和恢复行为 |

### 4.2 当前 Manifest 字段速查

| 字段 | 当前值 | 作用 |
| --- | --- | --- |
| `manifest_version` | `3` | 使用 Manifest V3 |
| `version` | `0.4.0` | 扩展运行版本；与开发用 `package.json` 的包版本是不同字段 |
| `minimum_chrome_version` | `140` | Chrome 140 以下不受支持 |
| `background.service_worker` | `background/service-worker.js` | 后台事件入口 |
| `background.type` | `module` | 允许顶层 `import` |
| `action.default_title` | `翻译/恢复当前网页` | 初始悬停提示；运行时会加入版本和状态 |
| `commands._execute_action` | 平台快捷键 | 与左键 action 触发相同主动作 |
| `options_ui.page` | `options/index.html` | 设置页入口 |
| `options_ui.open_in_tab` | `true` | 在独立标签页打开设置页 |

### 4.3 API 权限速查

| 权限 | 当前代码使用位置 | 为什么需要 |
| --- | --- | --- |
| `activeTab` | action 或快捷键触发后 | 临时访问当前标签页，不申请所有网页的永久权限 |
| `scripting` | `toggleTranslation()` | 动态注入 `content/content.css`、`generated/provider-catalog.js`、`shared/core.js` 和 `content/content-script.js` |
| `contextMenus` | `initializeActionUi()` | 创建仅出现在扩展图标右键菜单中的调试和版本项 |
| `storage` | 后台与设置页 | 保存设置、Key、缓存、用量、运行快照和调试事件 |

### 4.4 Host permissions 速查

固定 `host_permissions` 覆盖：

- `api-free.deepl.com` 与 `api.deepl.com`
- `api.cognitive.microsofttranslator.com`
- `api.deepseek.com`
- `api.openai.com`
- `generativelanguage.googleapis.com`
- `api.anthropic.com`

`optional_host_permissions` 声明 `https://*/*`、`http://localhost/*` 和 `http://127.0.0.1/*`，但安装时不会授予。它们只用于自定义 OpenAI-compatible 服务：设置页在保存或测试时为用户填写的单个 origin 请求权限。固定 Provider 的 Base URL 仍由 allowlist 固定。Models.dev 不在 host permissions 中，因为运行中的扩展不向它发起目录请求。

### 4.5 关键消息接口速查

| 来源 | 消息或连接 | 用途 |
| --- | --- | --- |
| `content/content-script.js` | `START_RUN` | 建立任务快照，只取回非敏感公开设置 |
| `content/content-script.js` | `TRANSLATE_BATCH` | 发送已筛选和分批的文本，接收 ID 对齐的译文 |
| `content/content-script.js` | `CANCEL_RUN` | 第二次点击时取消请求并清理任务 |
| `content/content-script.js` | `STATUS` | 更新当前标签页徽标和 title |
| `content/content-script.js` | `OPEN_OPTIONS` | 从网页状态提示打开设置页 |
| `options/options.js` | `GET_OPTIONS_STATE`、`SAVE_SETTINGS`、`TEST_PROVIDER` | 管理完整设置、用量和连接测试 |
| `options/options.js` | `GET_DEBUG_LOGS`、`CLEAR_DEBUG_LOGS` | 读取或清空脱敏事件 |
| `options/options.js` | Port `debug-events-v1` | 接收实时事件、快照与重置通知 |

后台还保留 `CACHE_LOOKUP` 和 `CACHE_STORE` 消息处理接口；当前主要翻译路径在 `TRANSLATE_BATCH` 内部完成持久缓存查找与写入。

---

## 第 5 部分：故障排查与安全边界

### 5.1 常见故障

| 症状 | 最可能原因 | 处理方式 |
| --- | --- | --- |
| “加载已解压”失败 | 选错目录、Manifest JSON 错误、未知权限或 Chrome 版本低于 140 | 选择 `web-translate` 仓库中的 `chrome-extension/`；查看扩展页错误；升级 Chrome |
| Worker 注册失败并提示本地目录或运行时未加载 | 生成产物缺失、过期或构建失败 | 使用 Node.js 24，先运行 `npm install --ignore-scripts`，再运行 `npm run build:chrome`；确认 `chrome-extension/generated/` 和 `chrome-extension/options/` 产物存在后重新加载 |
| 设置页没有自动打开 | 这是重新加载，不是首次安装 | 右键图标选择“打开详细调试面板” |
| 源码已改，但版本仍旧 | Chrome 仍加载旧包或另一份副本 | 对比扩展路径；点击“重新加载”；用运行时四种方法核对版本 |
| 左键后只打开设置页，徽标为 `SET` | 当前 Provider 缺 API Key，或本地目录与已保存模型不一致 | 在设置页填写 Key；若目录异常，重新构建并加载扩展；点击“保存并测试” |
| 左键后徽标为 `ERR` | 当前页面不允许脚本注入，或注入阶段报错 | 换普通 HTTP(S) 页面；查 Service Worker Console 和扩展“错误”页 |
| 本地 `file://` 页面不工作 | 用户尚未允许文件网址访问 | 右键图标 → 管理扩展程序 → 开启“允许访问文件网址”，再刷新文件页 |
| 页面没有可见译文 | 页面没有符合语言和可见性规则的文本，或内容位于 PDF、iframe、Shadow DOM、输入框等边界内 | 看右下角状态；换普通文章；在网页 DevTools 检查候选 DOM |
| 修改内容脚本后仍执行旧逻辑 | 旧脚本已经注入现有标签页 | 重新加载扩展，再刷新宿主网页，然后重新点击图标 |
| Service Worker 显示 `inactive` | 正常的空闲终止 | 触发 action 或消息唤醒；不要靠长期打开 DevTools 掩盖生命周期问题 |
| `chrome://extensions` 没有内容脚本错误 | 内容脚本错误属于网页运行上下文 | 打开网页 DevTools，并切换到扩展内容脚本上下文 |
| 网页 Network 看不到 Provider 请求 | 请求由 Service Worker 发出 | 打开 Service Worker DevTools 的 Network，在触发操作前开始记录 |
| 调试面板一直为空 | 调试未开启，或开启后尚未触发操作 | 在右键菜单或设置页开启记录；再测试连接或翻译 |
| HTTP 401/403 | API Key、账户、Azure 资源区域或 Provider 权限错误 | 核对 Provider 控制台配置；不要把 Key 发给他人排查 |
| 自定义服务提示需要授权 | 尚未允许扩展访问该 API origin，或 Base URL 无效 | 重新保存或测试并在 Chrome 提示中允许该 origin；不要授予与实际服务无关的域名 |
| 模型 Provider 返回“请求失败”或“未完整返回译文” | 账户无权使用固定模型、模型暂不可用、输出截断，或 Provider 响应不符合协议 | 查看 `model.request.*`、`sdk.request-*` 与 `model.response.validated`；核对 HTTP 状态、响应模型和结束原因，不要分享正文或 Key |
| HTTP 429 或连续重试 | Provider 限流或配额不足 | 等待 `Retry-After`；看脱敏事件的重试等待；避免反复点击 |
| 重新加载后调试事件消失 | 调试事件位于 `storage.session` | 这是预期行为；复现前重新开启并触发操作 |

### 5.2 先选对调试上下文

```text
清单无法加载、Worker 注册失败
  → chrome://extensions 的“错误”

action、右键菜单、权限、Provider、缓存、重试
  → Service Worker DevTools

DOM 扫描、节点插入、网页布局、内容脚本异常
  → 被翻译网页的 DevTools

表单、目录、模型选择、调试面板 UI
  → 设置页 DevTools

snapshot、allowlist、schema 或 SDK bundle 构建失败
  → 终端中的校验/构建错误

只需请求状态、耗时、字符数、重试原因
  → 项目内置脱敏调试面板
```

### 5.3 安全边界

#### 网页边界

- 把网页 DOM 和所有文本当作不可信输入。
- 内容脚本可以读取和修改 DOM，但不应得到 API Key。
- 不要从内容脚本接收任意 URL 后让后台代为请求；只接受业务参数，并在后台构造允许的 Provider URL。
- 把外部返回值写入 DOM 时使用 `textContent`，不要用 `innerHTML`。

#### 密钥边界

- 永远不要把真实 API Key 写入 `manifest.json`、任何 `.js` 文件、测试、文档或版本控制。
- Key 只保存在本机 `chrome.storage.local`。当前后台用 `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` 阻止内容脚本直接读取。
- 浏览器端 BYOK 不能替代服务端密钥保险箱。若面向其他用户并由开发者承担费用，应使用带鉴权、配额和速率限制的后端代理。
- 不要把设置页 Storage、Service Worker Network Headers、Payload、Response、Copy as cURL 或 HAR 交给第三方。

#### 权限边界

- 用 `activeTab` 保持网页访问短暂且由用户触发，不要为了方便改成所有网页永久权限。
- 固定 API 使用精确 `host_permissions`。固定模型目录不接受运行时修改 Base URL。
- 自定义 OpenAI-compatible 服务只接受 HTTPS，或本机 `localhost` / `127.0.0.1` 的 HTTP 地址；保存或测试时按单个 origin 请求可选权限，拒绝授权就停止。
- 增加固定 Provider 时必须同时审查 SDK 依赖、snapshot、schema、allowlist、官方 API host、清单权限和生成产物，不能用通配权限绕过设计边界。

#### 代码与 CSP 边界

- 所有可执行 JavaScript 必须随扩展打包。Vue 与 Vercel AI SDK 依赖在开发阶段分别构建进 `chrome-extension/options/` 和 `chrome-extension/generated/provider-runtime.js`；扩展运行时不得下载 SDK 或其他待执行逻辑。
- Models.dev 只作为仓库内固定 snapshot 的可追溯来源；运行时不得获取或执行其内容。
- 不使用 `eval()`、`new Function()`、远程 `<script>` 或从网络下载再执行的代码。
- 不为方便调试放宽 Manifest V3 的扩展页 CSP。
- 构建前校验 snapshot/schema/allowlist；运行时只接受 allowlist 中的 Provider 和模型，并对 Provider 返回做结构、ID、数量和长度校验。

#### 调试边界

- 内置调试事件是经过白名单筛选的元数据，适合分享前再次人工检查。
- Chrome DevTools Network、Console 和 Extension Storage 是原始诊断面，默认不脱敏。
- 关闭调试模式会停止新增内置事件，但不会清除既有事件；需要时点击“清空事件”。
- 打开 Service Worker DevTools 会改变 Worker 生命周期。调试完成后关闭它，再验证真实休眠与唤醒行为。

---

## Chrome 官方资料

本文中的 Chrome 平台事实以以下官方文档为准：

- [Hello World：加载、固定与重新加载已解压扩展](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- [Debug extensions：Service Worker、内容脚本和网络调试](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug)
- [Manifest file format](https://developer.chrome.com/docs/extensions/reference/manifest)
- [Manifest V3 概览](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [chrome.action](https://developer.chrome.com/docs/extensions/reference/api/action)
- [Manifest background / Service Worker](https://developer.chrome.com/docs/extensions/mv3/manifest/background)
- [Extension Service Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Content scripts 与 isolated world](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Options page](https://developer.chrome.com/docs/extensions/develop/ui/options-page)
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [View and edit extension storage](https://developer.chrome.com/docs/devtools/storage/extensionstorage)
- [Manifest Content Security Policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [chrome.runtime](https://developer.chrome.com/docs/extensions/reference/api/runtime)
- [chrome.contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)

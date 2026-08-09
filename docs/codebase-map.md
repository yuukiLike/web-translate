# 代码地图：从目录到一次完整翻译

本文面向第一次打开仓库、还不知道从哪里读起的开发者。它回答四个问题：哪些文件能改，模块如何依赖，一次点击经过哪些代码，以及测试分别守住什么行为。

## 先记住三条规则

1. 日常开发主要修改 `src/**`、`chrome-extension/background/**`、配置文件和测试。
2. `chrome-extension/generated/*.js`、`chrome-extension/options/options.{js,css}` 与 `chrome-extension/popup/popup.{js,css}` 是生成文件。不要手工编辑；修改对应源码后重新构建。`chrome-extension/popup/index.html` 是手写 HTML 壳。
3. `chrome-extension/background/service-worker.js` 不是巨型业务文件。它只负责导入 runtime、创建后台应用并同步注册 Chrome 监听器；工具栏点击由 Manifest 打开的 popup 接管，后台不注册 `chrome.action.onClicked`。

## 总体依赖方向

```text
配置、数据、Schema
  ├─→ scripts/validate-provider-config.mjs
  └─→ scripts/build-extension-runtime.mjs
        ├─ src/core/     ─→ chrome-extension/generated/core.js
        ├─ src/content/  ─→ chrome-extension/generated/content-script.js
        ├─ src/provider/ ─→ chrome-extension/generated/provider-runtime.js
        └─ 配置数据       ─→ chrome-extension/generated/provider-catalog.js

src/options/ ─→ scripts/build-options.mjs
              └─→ chrome-extension/options/options.js + options.css

src/popup/ ─→ scripts/build-popup.mjs
            └─→ chrome-extension/popup/popup.js + popup.css

chrome-extension/manifest.json
  ├─→ background/service-worker.js
  ├─→ popup/index.html
  ├─→ options/index.html
  └─→ popup 发送 TOGGLE_ACTIVE_TAB，后台动态注入 content.css + 三个 generated 文件
```

依赖只应沿箭头向右走。`src/core/` 不依赖 Chrome API；`src/content/` 只通过 `RuntimeClient` 向后台发消息；网页脚本永远不能直接读取设置或 API Key。测试可以直接导入手写模块，但产品源码不应反向依赖测试。

## 根目录

| 文件 | 职责 |
| --- | --- |
| `.nvmrc` | 固定本地开发使用的 Node.js 24 主版本。 |
| `.gitignore` | 排除依赖、临时文件和本地产物。 |
| `AGENTS.md` | 约束代码可读性、单文件规模和异常优先的协作规则。 |
| `DESIGN.md` | 设置页的视觉系统、布局、颜色、图标和交互决策；重构 UI 前必须先读。 |
| `README.md` | 面向使用者的安装、Provider、隐私、调试和开发入口。 |
| `package.json` | Node 版本、构建/检查/测试命令，以及 Chrome 产品与构建依赖。 |
| `package-lock.json` | npm 根据精确依赖生成的锁文件；通过 npm 更新，不手工改依赖树。 |

## `chrome-extension/`：Chrome 直接加载的包

| 文件或目录 | 职责 | 是否手工维护 |
| --- | --- | --- |
| `manifest.json` | 声明 Manifest V3、权限、固定 API host、Service Worker、action popup、快捷键和设置页。 | 是 |
| `assets/icons/icon.svg` | 主图标的可编辑矢量源。 | 是 |
| `assets/icons/icon-small.svg` | 小尺寸图标的可编辑矢量源。 | 是 |
| `assets/icons/icon-{16,32,48,128}.png` | Manifest 实际引用的固定尺寸导出图。 | 由图标源导出后审查 |
| `content/content.css` | 注入网页的译文与状态提示样式。 | 是 |
| `popup/index.html` | action popup 的手写 HTML 壳，提供固定的“翻译 / 恢复当前网页”、设置和调试日志入口。 | 是 |
| `popup/popup.js` | `src/popup/` 编译后的交互 bundle。 | 否 |
| `popup/popup.css` | `src/popup/popup.css` 编译后的样式。 | 否 |
| `options/index.html` | 设置页 HTML 壳，按顺序加载目录、核心和 Vue bundle。 | 是 |
| `options/options.js` | `src/options/` 编译后的 Vue JavaScript。 | 否 |
| `options/options.css` | `src/options/` 合并压缩后的 CSS。 | 否 |
| `generated/provider-catalog.js` | 深度冻结的 Provider 与模型目录。 | 否 |
| `generated/core.js` | `src/core/` 的浏览器 IIFE bundle。 | 否 |
| `generated/content-script.js` | `src/content/` 的浏览器 IIFE bundle。 | 否 |
| `generated/provider-runtime.js` | `src/provider/` 与 Vercel AI SDK 的压缩 bundle，只在后台执行。 | 否 |

### `chrome-extension/background/`：后台模块

后台使用工厂函数显式注入依赖，测试可以替换 Chrome API、网络和计时器。异常先在模块边界被拒绝，主流程因此保持直线。

| 文件 | 单一职责 |
| --- | --- |
| `service-worker.js` | 极薄装配入口：导入三个生成 runtime 与 `app.js`、创建应用、同步注册安装、右键菜单、消息、Port 和标签页关闭监听器并启动。Manifest V3 要求监听器在入口求值时注册；这里不再注册 `action.onClicked`。 |
| `app.js` | 组合全部后台服务，管理启动就绪 Promise，把安装、菜单、消息、Port 和标签页关闭事件适配为应用方法。popup 的主动作通过消息进入，不再需要 action 点击适配器。 |
| `action-ui.js` | 管理 popup 触发后的脚本注入、徽标、title 与图标右键菜单；为每个标签页保存最新 Badge 修订，慢写入结束后会重放最新状态。 |
| `message-router.js` | 按消息类型路由 popup、内容脚本和设置页请求；先校验来源，再调用具体服务；设置页状态同时返回设置与用量。 |
| `validation.js` | 校验 runId、语言方向、段落 ID、单段长度、批次数量和总字符数。 |
| `settings-store.js` | 初始化受信任存储访问级别，规范化/保存设置，检查 Key、模型和自定义域名权限。 |
| `run-store.js` | 编排任务启动、替换、取消和标签页关闭；把内存活动、启动 token、在途清理与持久状态组合成同一标签页串行生命周期。 |
| `run-start-registry.js` | 保存仍在处理的 START token；取消或更新启动会直接标记对应 token，不依赖有数量上限的全局墓碑。 |
| `run-activity-registry.js` | 保存当前 Worker 内的任务快照、批次序号和活动 `AbortController`；取消时同步中止网络并释放本次运行数据。 |
| `run-cleanup-registry.js` | 登记 run 级快照删除和 tab 级 current 指针删除；旧删除完成前禁止复用对应键或标签页，避免 ABA 误删新任务。 |
| `run-cleanup-coordinator.js` | 协调持久化降级产生的多个在途删除、迟到 current 清理后的内存释放，以及关闭标签页屏障何时可以安全解除。 |
| `run-persistence.js` | 读写任务快照与 current-run 状态；兼容旧字符串，以 `{ runId, state }` 区分 active/cancelled，并在存储写失败时返回可审计的降级结果与在途清理。 |
| `run-state.js` | 集中定义任务取消/失效错误，并从 active/cancelled current-run 中选择可公开的 runId。 |
| `status-controller.js` | 用 `tabId + runId` 取消墓碑、消息到达修订和完成稳定窗口拒绝旧状态；核心生命周期不等待非关键 Badge I/O。 |
| `cache-store.js` | 实现 90 天、750 条、约 7.5 MB 的站点隔离持久缓存，以及代次清空和维护。 |
| `usage-store.js` | 按月份和 Provider 累加 API 次数、字符与 token，保留 Provider 未返回 token 的次数，最多保存 12 个月供设置页展示普通用量统计。 |
| `batch-translator.js` | 组织一次批次的缓存命中、缺失翻译、输出校验、用量与缓存写入；在缓存读取、Provider 和持久化阶段都检查取消信号。 |
| `provider-service.js` | 在模型 Provider、自定义 Provider、Azure 与 DeepL 之间选择正确翻译器，并提供连接测试。 |
| `json-client.js` | 为 REST Provider 统一实现超时、JSON 大小限制、安全错误、最多三次尝试和 `Retry-After`。 |
| `request-errors.js` | 把网络与 SDK 错误转成安全错误码，判断是否可重试并提供可取消等待。 |
| `debug-metadata.js` | 生成不含凭据的 Provider/请求上下文，并把 endpoint 限制为安全 origin 与路径。用户开启调试时，DeepSeek 事件可附带受控请求正文投影。 |
| `debug-store.js` | 用字段白名单保存有界 session 事件，通过 Port 推送快照、增量事件和重置；不保存 Key、请求头或响应体。 |
| `request-payload-sanitizer.js` | 把 DeepSeek 的瞬时 `requestBody` 重建为有字段、条数和容量上限的 `requestPayload` 安全投影。 |
| `constants.js` | 集中维护缓存、消息、网络、调试字段、状态稳定窗口和菜单 ID 的限制。 |
| `utilities.js` | 提供数字规范化、ID、存储大小估算、运行键和自动回收的按键串行任务队列等后台通用能力。 |
| `providers/model-translator.js` | 构造防提示词注入的 JSON 翻译任务，控制模型层超时与重试，并校验完成原因。 |
| `providers/rest-translators.js` | 构造 Azure 与 DeepL 的固定 REST 请求，并验证各自响应结构和计费字符。 |

## `src/core/`：无 Chrome API 的共享核心

这一层是产品规则。后台、内容脚本和设置页都通过生成后的 `BilingualTranslatorCore` 使用同一套规范化逻辑。

| 文件 | 职责 |
| --- | --- |
| `main.js` | 把 `createCore()` 的冻结结果安装到 `globalThis.BilingualTranslatorCore`。 |
| `create-core.js` | 聚合并冻结核心公开接口，是其他层可用能力的白名单。 |
| `constants.js` | 定义设置、用量与缓存存储键、缓存协议版本、API Key 长度、模型 Provider 列表和目标模式。 |
| `settings.js` | 生成默认设置，规范化各 Provider，校验自定义 URL，返回不含凭据的公开任务设置。 |
| `provider-definitions.js` | 定义每种 Provider 的标签、字符/段落限制、最大并发和调用类型。 |
| `text.js` | 规范化正文、判断中英文方向、过滤无需翻译文本、切分长文、分批和计算稳定哈希。 |
| `cache.js` | 生成包含站点、Provider、模型、协议、方向和原文的缓存键，并选择 DeepL Free/Pro host。 |
| `model-response.js` | 从模型文本提取 JSON，严格校验译文数量、ID 唯一性和顺序。 |
| `value-utils.js` | 提供 record 判断、安全字符串、整数裁剪和月份键等通用纯函数。 |

## `src/content/`：网页扫描与双语渲染源码

内容脚本按“一次点击对应一个 `TranslationRun`”组织。运行结束后，元素索引、运行缓存和监听器一起释放。

### 运行编排

| 文件 | 职责 |
| --- | --- |
| `main.js` | 生成 bundle 的入口；第一次注入安装控制器，重复注入切换当前运行。 |
| `constants.js` | 集中维护选择器、时间窗口、优先级、批次上限和 750 条运行缓存上限。 |
| `controller.js` | 串行用户开关，创建/停止 `TranslationRun`，并清理上次异常遗留的 DOM。 |
| `translation-run.js` | 组装一次运行的所有服务，串行扫描轮次，吸收重扫请求并协调启动/停止。 |
| `site-profile.js` | 按精确 hostname 集中定义 X 与 Hacker News 的内容边界和安全呈现方式；未匹配站点保留通用扫描行为。 |
| `runtime-client.js` | 内容脚本与后台通信的唯一出口，统一检查 `{ ok: true }` 响应。 |
| `element-store.js` | 用 WeakMap 保存元素状态、修订号、布局签名、文本归属和译文来源，并用运行级集合跟踪需要确定性清理的 generated source。 |
| `root-queue.js` | 合并重叠待扫描根节点，避免同一轮重复遍历子树。 |
| `progress-tracker.js` | 按元素、方向和原文哈希去重计数；完成数只增不减，避免虚拟列表导致数字回退。 |
| `status-reporter.js` | 协调页面提示与后台徽标，等待稳定快照，并用 runId 使旧状态失效。 |
| `status-view.js` | 只负责创建、更新和移除页面状态 DOM，不负责运行时消息。 |

### `src/content/dom/`：DOM 边界

| 文件 | 职责 |
| --- | --- |
| `scanner.js` | 用 TreeWalker 把文本节点归属到正文候选块并保留段落边界；不决定翻译，也不改 DOM。 |
| `layout.js` | 集中读取样式、可见性、布局签名和视口优先级，避免各模块重复布局逻辑。 |
| `renderer.js` | 校验原文仍未变化；为普通站点创建 flow 译文，为 X 创建不进入宿主 child tree 的 generated presentation。 |
| `generated-presentation.js` | 管理 generated source 属性、离屏 description、ARIA 引用、完整性恢复和跨运行幂等清理。 |
| `generated-replacement-transfer.js` | 在同一 MutationObserver 批次内，把已跟踪 generated surface 原子迁移到语义等价的 fresh Element。 |
| `invalidation.js` | 统一使过期元素失效，清除旧译文，恢复被网站删除的译文，并清理移除子树。 |
| `mutation-monitor.js` | 先迁移同批 fresh replacement，再把其他 MutationObserver 事件归一化为待复核 source 和扫描根节点。 |
| `visibility-monitor.js` | 真正防抖处理 class/style 的布局与可见性变化；瞬时状态不清除 generated presentation。 |
| `node-utils.js` | 识别扩展自有节点、遍历文本节点并构造当前运行的 source 选择器。 |

### `src/content/translation/`：翻译计划与云调度

| 文件 | 职责 |
| --- | --- |
| `planner.js` | 把正文候选变成翻译记录；自动模式跳过中文，按方向/原文去重、拆分并登记进度。 |
| `run-cache.js` | 保存本次运行已得到的译文，按方向与原文隔离，并使用 750 条 LRU 上限。 |
| `batching.js` | 按语言方向、可见性、Provider 字符与段落上限取下一批。 |
| `cloud-translator.js` | 先解析运行缓存，再按并发请求后台；把响应回填到全部去重目标并触发渲染。 |

## `src/provider/`：模型 SDK 运行时源码

| 文件 | 职责 |
| --- | --- |
| `src/provider-runtime.js` | 极薄构建入口，把 `generateTranslation` 暴露为后台读取的冻结全局对象。 |
| `provider/catalog.js` | 从本地 snapshot 和 allowlist 查找固定 Provider/模型，并校验自定义 endpoint。 |
| `provider/validation.js` | 在任何 fetch 前校验 API Key、提示、消息和最大输出 token。 |
| `provider/model.js` | 显式创建四家 SDK 模型，并设置关闭或最低推理参数。 |
| `provider/observed-fetch.js` | 包装 fetch，发出方法、无查询 endpoint、状态、耗时和重试标记；DeepSeek 在调试开启时还提供实际 HTTP body，交由后台收窄为固定字段投影。 |
| `provider/generate-translation.js` | 组合目录、校验、模型和观测 fetch，调用 `generateText()` 且关闭 SDK 内部重试。 |
| `provider/result.js` | 把不同 SDK 返回规范化为统一文本、完成原因、响应身份和 token 用量。 |

## `src/options/`：设置页源码

Vue 设置页的视觉规则来自 `DESIGN.md`。重构状态和数据层时，不要顺带改变已确定的 UI 风格。

### 页面与组件

| 文件 | 职责 |
| --- | --- |
| `main.js` | 创建 Vue 应用并挂载到 `#app`。 |
| `App.vue` | 设置页外壳、配置/调试导航和各组件编排。 |
| `ProviderPicker.vue` | 展示三项推荐服务、可展开的其他 Provider、“付费 API”标签和一行计费提示。 |
| `ProviderFields.vue` | 按 Provider 类型渲染 Key、区域、Base URL、模型和本地模型元数据。 |
| `UsagePanel.vue` | 展示当月用量并提供清空翻译缓存入口。 |
| `DebugPanel.vue` | 展示请求优先的受控轨迹、DeepSeek 请求正文投影、筛选、跟随、复制和清空操作。 |
| `Mark.vue` | 产品的内联 SVG 标志。 |

### 状态与数据

| 文件 | 职责 |
| --- | --- |
| `useOptions.js` | 设置页主状态：加载、规范化、保存、测试、自定义权限、缓存清理和 storage 同步。 |
| `useDebug.js` | 调试 Port 的连接、心跳、重连、快照同步和组件卸载清理。 |
| `useDebugSettings.js` | 独立保存调试元数据与请求正文开关，并在失败时恢复已保存状态。 |
| `optionsRuntime.js` | 检查核心/runtime 完整性并统一设置页消息响应错误。 |
| `optionDefinitions.js` | 维护 Provider 与翻译方向的展示定义。 |
| `catalogData.js` | 把冻结目录转换为模型下拉、价格、上下文和 fallback 设置。 |
| `usageData.js` | 把月度存储转换为字符或 token 用量行；未返回的 token 显示为“未知”或“部分未知”。 |
| `debugConstants.js` | 定义调试事件中文名和请求开始/结束/失败集合。 |
| `debugFormat.js` | 安全格式化端点、主机、字段、时间、状态、摘要和搜索文本。 |
| `debugRows.js` | 把事件转换为 UI 行，并按 requestId 与 attempt 合并请求生命周期。 |
| `formatters.js` | 提供设置页无副作用的错误、数字、字符串和 record 格式化函数。 |
| `data.js` | 统一重导出设置页数据能力，缩短组件导入面。 |

### 样式

| 文件 | 职责 |
| --- | --- |
| `options.css` | 样式入口，只按层次导入设置页分区样式。 |
| `styles/base.css` | 变量、字体、重置与基础元素。 |
| `styles/shell.css` | 页面外壳、顶部导航、品牌和主内容布局。 |
| `styles/setup.css` | 首屏介绍、配置表面和隐私区。 |
| `styles/provider.css` | Provider 卡片、更多服务和模型信息。 |
| `styles/controls.css` | 表单字段、按钮、开关、折叠区和状态。 |
| `styles/usage.css` | 月度用量列表与缓存操作。 |
| `styles/debug.css` | 调试页头部、摘要、筛选与工具栏。 |
| `styles/debug-events.css` | 请求/事件列表、详情字段和状态样式。 |
| `styles/responsive.css` | 700px、520px、480px 等响应式调整和减少动态效果。 |

## `src/popup/`：工具栏弹窗源码

popup 是短生命周期的受信任扩展页面，不持有翻译任务，也不读取 API Key。它只展示当前配置摘要并把明确的用户动作交给后台。

| 文件 | 职责 |
| --- | --- |
| `main.js` | popup bundle 入口：注入 Chrome API、document 和关闭函数，创建应用并加载状态。 |
| `popup-app.js` | 发送 `GET_POPUP_STATE` / `TOGGLE_ACTIVE_TAB`，控制忙碌与错误提示；设置使用 `openOptionsPage()`，调试打开 `options/index.html#debug`。 |
| `popup.css` | 维护 350px popup 的既有视觉、按钮、状态和减少动态效果样式。 |

## Provider 配置、数据与 Schema

| 文件 | 职责 |
| --- | --- |
| `config/provider-allowlist.json` | 安全敏感白名单：固定 SDK 包、官方 Base URL、默认模型和默认 Provider。 |
| `data/models-dev-subset.json` | 固定上游 commit 的本地模型子集、成本、能力和限制。 |
| `schemas/provider-allowlist.schema.json` | 约束 allowlist 结构和允许字段。 |
| `schemas/model-catalog.schema.json` | 约束模型 snapshot 的 Provider、模型、成本、能力和来源字段。 |

## `scripts/`：构建与检查

| 文件 | 职责 |
| --- | --- |
| `validate-provider-config.mjs` | 用 AJV 校验两个 JSON Schema，再检查来源 SHA、Provider 集合、SDK、URL 和默认模型等跨文件不变量。 |
| `build-extension-runtime.mjs` | 生成目录脚本，并用 esbuild 分别打包核心、内容脚本和 Provider runtime；`--check` 只比较，不写文件。 |
| `build-options.mjs` | 编译 Vue SFC 与 CSS，拒绝外部依赖和动态代码；`--check` 验证提交产物未过期。 |
| `build-popup.mjs` | 从 `src/popup/main.js` 打包 `popup.js` 与 `popup.css`，拒绝外部依赖和动态代码；`--check` 验证提交产物未过期。 |
| `check-javascript.mjs` | 递归查找手写 JavaScript，并逐个运行 Node 语法检查。 |

## `test/`：按风险分层的自动验证

每个 `test(...)` 前必须有一行紧邻的中文注释，说明业务意图，而不是重复函数名。`contract/project-structure.test.mjs` 自动执行这条规则。

### `test/contract/`

| 文件 | 职责 |
| --- | --- |
| `project-structure.test.mjs` | 守住手写源码不超过 300 行，以及每个测试都有中文意图注释。 |
| `provider-config.test.mjs` | 验证 schema、跨文件安全约束和生成目录的递归冻结。 |

### `test/helpers/`

| 文件 | 职责 |
| --- | --- |
| `background-harness.mjs` | 构造可观测的 Chrome API、storage、action、权限和消息后台测试环境。 |
| `catalog-fixture.mjs` | 提供最小且合法的 Provider 目录测试数据。 |
| `content-dom-harness.mjs` | 用 happy-dom 加载生成内容脚本，模拟布局、runtime 消息与 DOM 变化。 |
| `options-page-harness.mjs` | 加载设置页产物，模拟扩展 API、调试 Port 和用户交互。 |
| `popup-page-harness.mjs` | 用 happy-dom 加载 popup 产物，模拟 runtime 消息、当前页状态和页面跳转。 |
| `provider-runtime-harness.mjs` | 模拟 fetch 并加载 Provider runtime，用于检查真实 SDK 请求形状。 |

### `test/integration/`

| 文件 | 职责 |
| --- | --- |
| `background-app.test.mjs` | 验证监听器注册、popup 状态/主动作消息、敏感来源边界、旧消息拒绝和后台重启状态。 |
| `background-cancellation.test.mjs` | 验证缓存读取取消、启动中取消、旧任务替换和取消持久化等全批次生命周期。 |
| `background-cleanup-races.test.mjs` | 验证持久化回退的慢 snapshot/current 删除、关闭标签页清理与重复同 runId START 都不能误删新任务的快照或 current 指针。 |
| `background-race-regressions.test.mjs` | 对抗验证反序启动、取消与 Badge/storage 竞态、标签页关闭和旧快照清理失败。 |
| `background-rollback-regressions.test.mjs` | 验证半提交回滚同步修正持久与内存指针，并等待慢 current 删除后再恢复旧任务；恢复失败则保持 fail-closed。 |
| `background-stale-read-failures.test.mjs` | 验证批次已读到旧快照后，取消或关闭标签页即使只能删除持久快照，当前 Worker 的内存屏障仍阻止调用 Provider。 |
| `background-storage-failures.test.mjs` | 验证 cancelled 写入失败时的删除兜底，以及 Badge API 挂起不能锁死取消、重启或后续任务。 |
| `background-usage.test.mjs` | 验证 Provider 缺少 usage 时，后台保留未知语义而不是持久化成零 token。 |
| `content-script.test.mjs` | 验证中文过滤、显式中译英、动态 DOM、运行缓存、重复注入和稳定进度。 |
| `content-hacker-news.test.mjs` | 验证 HN 标题的换行后同行延续、元信息过滤、动态条目和 hostname 隔离。 |
| `content-x-hover.test.mjs` | 验证 X 帖子 hover 不修改原始 child tree，且站点策略、相同译文兜底与 hostname 隔离稳定。 |
| `content-x-replacement.test.mjs` | 验证 fresh source/article/右栏/重复同文 replacement 在下一次绘制前迁移 generated surface。 |
| `content-x-surfaces.test.mjs` | 验证 Explore、Show more、瞬时 hidden/role/class/style、重挂和旧上下文清理。 |
| `content-x-stop-lifecycle.test.mjs` | 验证停止运行早于 removal record 交付时，脱离的 generated source 仍会完整清理。 |
| `options-page.test.mjs` | 验证本地资产/CSP、首屏契约、Provider 草稿、付费 API 标签与计费提示、保存测试顺序和调试 Port 生命周期。 |
| `provider-runtime.test.mjs` | 验证非法 Provider 预先拒绝、四家官方 SDK endpoint/低推理参数，以及缺失 usage 不会伪装成零 token。 |

### `test/unit/`

| 文件 | 职责 |
| --- | --- |
| `background-cache.test.mjs` | 缓存命中、站点隔离、清空代次和任务快照恢复。 |
| `background-debug-metadata.test.mjs` | 验证自定义服务的真实 adapter 标签和默认推理策略不会被调试元数据误报。 |
| `background-debug-store.test.mjs` | 验证 DeepSeek `requestBody` 只保存为有界 `requestPayload`，并拒绝 Key、Authorization、请求头和响应体。 |
| `background-run-lifecycle.test.mjs` | 对抗验证 501 次取消、删除失败后的取消终态、标签页清理失败、旧字符串兼容与后台重启。 |
| `background-status-races.test.mjs` | 验证冷 Worker 的反序状态恢复、多个取消墓碑，以及慢旧 Badge 写入结束后重放最新状态。 |
| `background-status.test.mjs` | 验证完成稳定窗口、settling 失效、旧任务忽略和取消覆盖。 |
| `background-validation.test.mjs` | 消息长度/唯一性边界、扩展页身份和自定义域名权限。 |
| `content-services.test.mjs` | 运行缓存隔离/上限、只增完成数、待处理取消和完成状态失效。 |
| `content-site-profile.test.mjs` | 验证 X/Hacker News 精确 hostname、站点选择器、呈现方式和通用站点回退。 |
| `core-cache.test.mjs` | 缓存语义边界、DeepL host 和译文长度上限。 |
| `core-settings.test.mjs` | 默认值、枚举、并发、模型 allowlist、自定义 URL、公开设置和错误提示。 |
| `core-text.test.mjs` | 语言判断、正文过滤、规范化、长文切分、批次顺序和模型 JSON ID。 |
| `options-data.test.mjs` | 模型目录、用量、调试脱敏和请求生命周期合并。 |
| `provider-observed-fetch.test.mjs` | 验证只有显式启用时才采集瞬时请求 body，且常规请求事件仍保持安全元数据边界。 |

## `docs/`：不同读者的入口

| 文件 | 职责 |
| --- | --- |
| `README.md` | 文档索引、适用读者和推荐阅读顺序。 |
| `codebase-map.md` | 当前文件；解释目录、文件、依赖、生成边界和调用链。 |
| `chrome-extension-basics.md` | 加载扩展并理解 Manifest V3 运行上下文、权限和 DevTools。 |
| `debugging.md` | 查看受控请求事件与 DeepSeek 请求正文投影，并用三类 DevTools 排查运行问题。 |
| `provider-catalog.md` | 解释固定 snapshot、allowlist、模型 SDK、DeepSeek 三层请求转换和目录更新流程。 |
| `x-hover-rendering-postmortem.md` | 记录 X hover 跳动的根因、修复演进、fresh Element 状态迁移约束和完整回归矩阵。 |

## 从点击图标到看到译文

下面是主路径。任何一步失败，都可以用文件名快速确定应查网页 DevTools、后台 DevTools 还是测试。

1. 用户点击工具栏图标或快捷键，Chrome 根据 Manifest 打开 action popup；Service Worker 不接收 `action.onClicked`。
2. popup 加载时发送 `GET_POPUP_STATE`，展示版本、Provider、模型、目标语言、调试开关与当前页可用性；主按钮的文案固定为“翻译 / 恢复当前网页”，不推测页面当前处于翻译还是原文状态。
3. 用户点击主按钮后，popup 发送 `TOGGLE_ACTIVE_TAB`。`message-router.js` 验证消息来自受信任扩展页面，查询当前标签页，等待安全存储初始化完成，再把标签页交给 `action-ui.js`。设置按钮调用 `openOptionsPage()`；调试按钮打开 `options/index.html#debug`。
4. `action-ui.js` 先通过 `settings-store.js` 检查 Provider、Key、模型和权限。失败时显示 `SET` 或 `ERR`，不会注入脚本；检查通过后注入 `content.css`、`provider-catalog.js`、`core.js` 和 `content-script.js`。
5. `src/content/main.js` 的生成代码发现没有控制器，于是 `controller.js` 创建一个带唯一 runId 的 `TranslationRun`，再由 `runtime-client.js` 发送 `START_RUN`。
6. `message-router.js` 验证消息来自网页并创建 START token；`settings-store.js` 返回公开设置；`run-store.js` 固定本次设置、缓存代次和站点来源快照，`run-persistence.js` 将 current-run 提交为 active；`status-controller.js` 再标记当前任务。无论启动成功还是失败，token 都会在 `finally` 释放。
7. `translation-run.js` 组装元素索引、扫描器、计划器、运行缓存、渲染器和两个 DOM 监听器，把 `document.body` 放入 `root-queue.js`。
8. `dom/scanner.js` 用 TreeWalker 识别正文候选；`translation/planner.js` 判断方向、在自动模式跳过中文、过滤无效文本、切分长文、同批去重并登记进度。
9. `translation/run-cache.js` 先返回本次运行已经翻译过的方向+原文。命中时直接渲染，不再向后台发请求。
10. `translation/cloud-translator.js` 按视口优先级和 Provider 限制分批，通过 `runtime-client.js` 发送 `TRANSLATE_BATCH`。
11. `message-router.js` 再次验证 runId、方向、段落数量、ID 和字符数，并从 `run-store.js` 取回启动时的固定快照。
12. `batch-translator.js` 先调用 `cache-store.js`。缓存键包含站点、Provider、模型、协议、语言方向和原文，因此不会跨语义误用。
13. 全命中时后台直接返回。未命中时 `provider-service.js` 选择 `model-translator.js` 或 `rest-translators.js`；请求层统一处理取消、超时、有限重试和安全调试事件。
14. Provider 响应通过完成原因、JSON、ID、数量和译文长度校验后，后台记录普通用量统计，写入持久缓存，再把 ID 对齐的结果返回内容脚本。
15. `cloud-translator.js` 写入运行缓存并回填所有去重目标；`dom/renderer.js` 确认原文未变化，普通页面用 `textContent` 创建 flow 译文，X 则把文本写入 generated source 属性并关联离屏 description；`progress-tracker.js` 只增加已完成数。
16. `status-reporter.js` 等待 DOM 和计数稳定后发送完成状态；`status-controller.js` 先按消息到达顺序分配修订，再做后台稳定窗口检查；`action-ui.js` 在慢 Badge API 返回后重放最新修订，因此旧完成或旧进度都不能覆盖新状态。
17. SPA、无限滚动或懒加载触发 `mutation-monitor.js` 与 `visibility-monitor.js`。同批 fresh replacement 会先迁移 generated surface；其他受影响根节点再进入防抖复核，已有译文优先从运行缓存恢复。
18. 用户再次打开 popup 并点击恢复时，后台重复注入内容脚本，已有控制器收到 toggle。`TranslationRun.stop()` 停止监听器、清理当前 runId 的 DOM、清空运行缓存并发送取消与关闭状态。后台先尝试把 current-run 持久化为 cancelled；若存储写失败，则至少删除 current 指针或快照，并保留当前 Worker 的取消屏障。在途旧删除结束前，同一 runId 不能复用。
19. 用户直接关闭标签页时，`tabs.onRemoved` 调用 `app.onTabRemoved()`；`run-store.js` 立即中止该标签页的活动请求并建立 removed-tab 屏障，再处理持久终态与 session 快照。所有可能迟到的清理结束前不会释放 tabId，避免复用标签页的新任务被旧清理误删。

## 修改代码时从哪里开始

| 想改什么 | 从这里开始 | 同时检查 |
| --- | --- | --- |
| 中文过滤、语言方向、切分 | `src/core/text.js`、`src/content/translation/planner.js` | `test/unit/core-text.test.mjs`、`test/integration/content-script.test.mjs` |
| 重复翻译与缓存 | `src/content/translation/run-cache.js`、`chrome-extension/background/cache-store.js` | content service、background cache 与集成测试 |
| 进度抖动或旧状态 | `src/content/progress-tracker.js`、`src/content/status-reporter.js`、`chrome-extension/background/status-controller.js` | content service、background status 与内容脚本集成测试 |
| DOM 识别或插入位置 | `src/content/dom/scanner.js`、`src/content/dom/renderer.js`、`src/content/site-profile.js` | content DOM harness、X/HN 集成测试与 [X hover 故障复盘](./x-hover-rendering-postmortem.md) |
| X hover、虚拟列表或 fresh replacement | `src/content/dom/generated-presentation.js`、`src/content/dom/generated-replacement-transfer.js`、`src/content/dom/mutation-monitor.js` | `test/integration/content-x-*.test.mjs` 与 [X hover 故障复盘](./x-hover-rendering-postmortem.md) |
| Provider 请求、重试 | `provider-service.js`、`providers/`、`src/provider/` | Provider runtime 集成测试和调试文档 |
| Provider 标签或价格展示 | `src/options/ProviderPicker.vue`、`catalogData.js`、`data/models-dev-subset.json` | options data 单元测试、options page 集成测试和 `docs/provider-catalog.md` |
| popup 主动作或入口 | `src/popup/`、`message-router.js`、`action-ui.js` | Manifest、`background-app.test.mjs`、`npm run check:popup` 和 Chrome 手工验证 |
| 设置或调试界面逻辑 | `src/options/useOptions.js`、`useDebug.js`、对应 Vue 组件 | options data 单元测试与 options page 集成测试 |
| 设置页视觉样式 | `DESIGN.md`、`src/options/styles/` | 先保持现有视觉决策，再验证 700/520/480px 断点 |
| 构建产物过期 | 对应 `src/` 源码与 `scripts/build-*.mjs` | 运行 `npm run build:chrome`，不要手改生成文件 |

## 最小验证命令

```bash
npm run check
```

它依次验证 runtime、设置页和 popup 生成产物、全部手写 JavaScript 语法，以及 contract、unit、integration 三层测试。检查不调用真实 Provider，也不需要 API Key。

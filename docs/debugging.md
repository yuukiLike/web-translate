# 调试模式与请求诊断

调试模式回答的是“扩展正在做什么、请求到了哪里、实际给 DeepSeek 的参数是什么、为什么重试或失败”。只有用户主动开启“记录事件”后，扩展才会把事件暂存在 `chrome.storage.session`；这些事件默认只含白名单元数据，不含网页正文。只有再单独开启“DeepSeek 请求正文”，普通窗口中的 DeepSeek `sdk.request-start` 才可能附带名为 `requestPayload` 的安全投影；它只允许 `model`、`max_tokens`、`messages[].role/content` 和 `thinking.type`。

`messages` 可能包含正在翻译的网页原文，因此“受控投影”只表示字段范围经过限制，不表示内容适合公开分享。内置日志始终不记录 API Key、Authorization、其他请求头、Provider 响应体或完整错误原文。

升级前只有 `debugLogging: true` 的设置不会自动获得正文授权：缺少 `debugRequestPayload` 时会按 `false` 处理。无痕窗口可以产生不含正文的调试元数据，但即使两个开关都开启，也永不捕获或暂存请求正文。关闭“DeepSeek 请求正文”或关闭“记录事件”都会撤销正文授权，并从后台内存与 `chrome.storage.session` 的既有事件中移除 `requestPayload`；普通元数据事件仍会保留，直到点击“清空”或 session 生命周期结束。

面板轨迹只覆盖 `background`、`cache` 和 `provider`。页面扫描、增量内容发现与 DOM 插入发生在内容脚本中，不会进入这份轨迹；这部分必须打开被翻译网页的 DevTools 排查。

## 最快开始

1. 点击工具栏中的扩展图标，打开 popup。
2. 点击“调试日志”，进入详细调试面板。
3. 主动开启“记录事件”。开关会立即保存，不需要再点击配置页的“保存并测试”；此时只记录元数据。
4. 只有需要查看 DeepSeek 正文时，再单独开启“DeepSeek 请求正文”。
5. 在调试面板点击“测试当前服务”，或回到网页，通过 popup 的“翻译 / 恢复当前网页”触发一次翻译。当前服务为 DeepSeek 且两个开关均开启时，连接测试会生成一条包含 `hello` 测试文本的可见正文样例。
6. 先看默认的“请求”视图；需要完整链路时切到“全部事件”，只排查失败时切到“错误”。
7. 按相同 `runId`、`requestId` 和 `attempt` 阅读展开后的元数据。
8. 排查结束后关闭“记录事件”；需要删除普通元数据事件时点击“清空”。

“记录事件”是独立保存的实时调试开关，也是正文授权的前置条件。关闭后会停止新增事件、断开实时连接、把“DeepSeek 请求正文”重置为关闭，并清除既有事件中的 `requestPayload`；不含正文的普通元数据事件不会自动删除。要删除所有已有事件，再点击“清空”。

## 面板视图与操作

- **请求优先：** 面板默认打开“请求”。它按 `requestId` 和 `attempt` 把同一次网络尝试的开始、完成或失败事件合并成一行，优先显示方法、主机、路径、HTTP 状态和耗时。一次重试会作为新的 `attempt` 单独显示。
- **全部事件：** “全部事件”保留后台、缓存与 Provider 的受控事件顺序，适合沿 `runId` 查看批次、缓存、重试和用量。
- **错误过滤：** “错误”只显示 HTTP 状态不小于 400、带安全错误码，或状态为 `error` / `failed` 的行。
- **搜索：** “筛选轨迹”只搜索当前视图，范围包括事件名称与代码、摘要、状态，以及展开详情中的字段名和值。可直接搜索端点、模型、HTTP 状态或错误码。
- **展开详情：** 点击任一行可展开该行的全部受控元数据；请求行显示该次尝试合并后的字段。
- **仅在底部跟随：** 位于列表底部时，新事件会自动滚动到最新位置。向上滚动会停止跟随，避免正在阅读的内容跳走；点击“继续跟随”会回到底部并恢复自动滚动。
- **受控复制：** “复制当前视图”只复制当前模式经过搜索后仍可见的行，并输出白名单字段；仅在用户另行授权且实际捕获到 DeepSeek 正文时，JSON 才会包含 `requestPayload` 安全投影。它不包含 Key、Authorization、其他请求头或响应体，但投影中的 `messages` 可能含网页原文；复制前必须检查并脱敏。

### 测试当前服务

“测试当前服务”会先校验并保存调试面板当前使用的 Provider 配置，再由后台发起真实请求：模型 Provider 和 Azure 使用一条很小的英译中测试，DeepL 查询用量端点。自定义服务会先请求当前 API origin 的 Chrome 权限。测试可能消耗 Provider 配额或产生少量费用。

开启“记录事件”后，这次测试会以元数据事件实时出现在“请求”和“全部事件”中，可用于把 Provider 配置或网络问题与网页扫描、DOM 插入问题分开。如果当前服务是 DeepSeek，并且还单独开启了“DeepSeek 请求正文”，测试请求中的 `hello` 会作为可见的 `requestPayload` 样例；只开“记录事件”不会显示正文。测试成功只证明后台能够访问当前服务，不证明网页内容脚本能够扫描或写入当前页面。

## 一次模型翻译的正常事件顺序

```text
run.started
  → batch.received
  → cache.resolved
  → model.request.started
  → sdk.request-start
  → sdk.request-end
  → model.request.completed
  → model.response.validated
  → provider.usage
  → batch.completed
```

如果整个批次都命中缓存，`cache.resolved` 后面不会出现 Provider 请求，这是正常行为。

Azure 和 DeepL 不经过 Vercel AI SDK，因此网络层事件仍使用原来的 `request.started`、`request.completed`、`request.failed` 和 `request.retry-scheduled`。

## 事件参考

| 事件 | 发生位置 | 含义 |
| --- | --- | --- |
| `settings.saved` | 设置页 → 后台 | 已保存规范化后的设置；不含 Key |
| `run.started` | 后台 | 当前标签页建立了固定设置快照 |
| `batch.received` | 后台 | 收到一批已验证的段落 |
| `cache.resolved` | 缓存 | 完成缓存命中/未命中统计 |
| `model.request.started` | 模型请求层 | 开始一次受扩展控制的尝试 |
| `sdk.request-start` | SDK fetch 层 | 显式 Provider 即将发出 HTTP 请求；只有普通窗口、DeepSeek 且两个调试开关均开启时，才会附带安全 `requestPayload` 投影 |
| `sdk.request-end` | SDK fetch 层 | 收到 HTTP 响应；非 2xx 也会出现此事件 |
| `sdk.request-error` | SDK fetch 层 | fetch 在拿到 HTTP 响应前失败或被取消 |
| `model.request.completed` | 模型请求层 | SDK 返回统一结果 |
| `model.request.failed` | 模型请求层 | 本次尝试失败；查看状态、错误码和可重试标记 |
| `model.request.retry-scheduled` | 模型请求层 | 后台已安排退避重试 |
| `model.response.validated` | 模型响应层 | 完成结束原因与统一 usage 提取，准备解析译文 JSON |
| `request.*` | Azure/DeepL REST 层 | 专用翻译 API 的请求、失败和重试 |
| `provider.usage` | 后台 | 提取并准备累加 token 或计费字符 |
| `batch.completed` | 后台 | 全部 ID 已对齐、译文已校验并可返回内容脚本 |
| `batch.failed` | 后台 | 整批失败；缓存不会写入不完整结果 |

## 字段参考

### 关联与身份

| 字段 | 如何使用 |
| --- | --- |
| `seq` | 当前 Service Worker 会话中的递增事件序号 |
| `timestamp` | 事件写入时间 |
| `workerInstanceId` | 区分 Service Worker 被终止后重新启动的不同实例 |
| `tabId` | 产生任务的标签页 ID |
| `runId` | 一次点击启动的页面翻译任务；串联多个批次 |
| `requestId` | 一次业务请求或 SDK HTTP 请求的标识 |
| `attempt` | 当前重试尝试，从 1 开始 |

`workerInstanceId` 变化说明 Chrome 重新启动了 Service Worker，不一定是错误。`runId` 相同但 `requestId` 不同，通常表示同一页面任务正在处理不同批次。

### 版本与配置

| 字段 | 含义 |
| --- | --- |
| `extensionVersion` | Chrome 实际加载的 Manifest 版本 |
| `catalogSourceSha` | 本地 models.dev snapshot 的完整 commit SHA |
| `provider` | 当前显式 Provider ID |
| `providerAdapter` | 实际适配器，如 `@ai-sdk/openai`、`@ai-sdk/openai:chat-custom` 或 `deepl-rest` |
| `apiHost` | 固定 Provider 的 allowlist 主机，或已获 Chrome 可选权限的自定义 API 主机；不含 Key、查询参数或正文 |
| `model` | 设置中选择且已通过 allowlist 的模型 ID |
| `inferencePolicy` | 翻译请求采用的推理策略，例如 `reasoning-none`、`thinking-minimal` 或自定义服务的 `provider-default` |
| `configuredConcurrency` | 设置值经过 Provider 上限裁剪后的并发数 |

这组字段适合排查“代码已更新但 Chrome 仍加载旧扩展”“设置页选择与实际请求不一致”以及“模型目录没有重新生成”。

### 批次、缓存和语言

| 字段 | 含义 |
| --- | --- |
| `sourceLanguage` / `targetLanguage` | 当前中英方向 |
| `segmentCount` | 批次内独立文本段数 |
| `sourceCharacters` | 当前批次原文字符总数；只保存数量，不保存具体文本 |
| `cacheHits` / `cacheMisses` | 缓存命中和未命中的段落数 |
| `batchIndex` / `batchCount` | 事件提供时的批次位置；动态无限滚动时总数可能未知 |
| `queueDepth` | 事件提供时等待处理的请求数 |

批次与缓存事件只显示数量，不显示具体段落内容。DeepSeek 的 `sdk.request-start` 是明确例外：用户先开启“记录事件”、再单独开启“DeepSeek 请求正文”后，普通窗口请求的 `requestPayload.messages` 才会显示实际发送的 system prompt 和用户段落。

### HTTP、重试与取消

| 字段 | 含义 |
| --- | --- |
| `method` | HTTP 方法 |
| `endpoint` | 已删除 query/hash 的官方 API origin 和路径 |
| `httpStatus` | HTTP 状态码 |
| `elapsedMs` | 当前层测得的耗时 |
| `timeoutMs` | 扩展设置的单次请求超时 |
| `retryAfterMs` | Provider 指示或扩展计算的下一次等待时间 |
| `retryable` | 当前错误是否符合有限重试条件 |
| `cancelled` | 用户恢复页面或任务失效导致的取消 |
| `errorCode` | 白名单化的错误类别，不包含原始 Provider 错误消息 |

扩展只自动重试网络错误、超时及有限的 `408/429/5xx` 状态，最多三次尝试。Vercel AI SDK 的内部重试被关闭，避免双重重试和额外费用。

### DeepSeek 请求正文安全投影

`src/provider/observed-fetch.js` 会在本次函数调用期间把 SDK 交给 `fetch` 的 JSON 字符串命名为 `requestBody`。后台不会原样持久化它：`debug-store.js` 解析后只把下面的固定子集重建为 `sdk.request-start.requestPayload`。它不是后台调用 Provider runtime 时的参数对象，也不是完整原始 body。

| 字段 | 含义 | 隐私提醒 |
| --- | --- | --- |
| `requestPayload.model` | 实际发送给 DeepSeek 的模型 ID；最长 300 字符 | 不含凭据 |
| `requestPayload.max_tokens` | 本批请求的最大输出 token，保存为非负整数 | 不含正文 |
| `requestPayload.messages[].role/content` | SDK 转换后的 system/user messages；最多 32 条，整个投影受 32 KiB 上限约束 | user message 可能包含网页原文；system message 包含翻译约束 |
| `requestPayload.thinking.type` | DeepSeek thinking 配置；翻译请求为 `disabled` | 不含正文 |
| `requestPayloadTruncated` | 为 `true` 时表示模型、thinking 或 messages 因数量/容量上限被截断 | 不应把缺少的内容误判为实际未发送 |

投影不会保存 `Authorization`、API Key、User-Agent 等请求头，也不会保存 DeepSeek 响应体。若请求不是 DeepSeek、“记录事件”或“DeepSeek 请求正文”任一未开启、请求来自无痕窗口，或 body 不能通过结构校验，则事件中不会出现 `requestPayload`。旧版只有 `debugLogging` 的设置同样不满足正文授权。三层参数如何转换的完整示例见 [DeepSeek 请求实例：从后台参数到 HTTP Body](./provider-catalog.md#deepseek-请求实例从后台参数到-http-body)。

### 模型响应和用量

| 字段 | 含义 |
| --- | --- |
| `responseId` | Provider 返回的响应标识 |
| `responseModel` | Provider 实际报告的模型 ID，可用于发现服务端别名或路由变化 |
| `finishReason` | SDK 归一化后的结束原因 |
| `rawFinishReason` | Provider 原始结束原因；没有时不显示 |
| `warningCount` | SDK 警告数量；不保存警告原文 |
| `inputTokens` / `outputTokens` | Provider 报告的输入与输出 token |
| `cacheReadTokens` | 从 Provider prompt cache 读取的 token |
| `cacheWriteTokens` | 写入 Provider prompt cache 的 token |
| `noCacheTokens` | 未使用 Provider cache 的输入 token |
| `billedCharacters` | Azure/DeepL 返回或扩展计算的计费字符 |

`responseModel` 与设置中的 `model` 不同不一定代表错误，Provider 可能返回版本化名称；应结合 Provider 官方控制台确认。`finishReason: length` 表示输出达到上限，扩展会拒绝不完整译文并提示减小批次。

## 查看、复制与清空 DeepSeek 请求正文

### 在内置日志中查看

1. 点击扩展图标，在 popup 中选择“调试日志”。
2. 先开启“记录事件”，再单独开启“DeepSeek 请求正文”。两个开关都会立即保存；开启前已经发生的请求不会补记正文。
3. 点击“测试当前服务”生成包含 `hello` 的可见样例，或通过 popup 在普通窗口翻译当前网页。无痕窗口永不捕获正文。
4. 在“请求”视图按 `api.deepseek.com`、`chat/completions` 或 `sdk.request-start` 筛选。
5. 展开对应请求，在“DeepSeek 请求正文”字段中查看格式化后的 `requestPayload` JSON；若同时出现“请求正文已截断：是”，说明这里只是被容量限制后的前缀。
6. 需要复制时，先缩小筛选范围，再点击“复制当前视图”。复制结果可能包含网页原文，只应保留在本机；分享前删除或替换 `messages` 内容。
7. 排查完成后关闭“记录事件”。这会撤销正文授权并清除既有 `requestPayload`，但保留普通元数据；要让列表完全为空，再点击“清空”。

### 用 Service Worker Network 交叉验证

内置日志保存的是结构受控的投影。需要确认 Chrome 最终发送的原始请求时：

1. 打开 `chrome://extensions`，点击本扩展的 `service worker`。
2. 在 DevTools 的 Network 开启 Preserve log，清空旧记录。
3. 重新触发一次请求，并筛选 `api.deepseek.com/chat/completions`。
4. 在 Payload 对照 HTTP body；在 Headers 确认 URL 和方法。不要复制或分享含真实 `Authorization` 的 Headers。
5. 原始 Network 与内置日志可以按时间、endpoint 和 `attempt` 对照；内置 `requestId` 不会作为 HTTP header 发给 DeepSeek。

Network、Copy as cURL 和 HAR 都不会自动脱敏。它们可能同时包含 API Key、网页原文和响应译文，日常排查优先使用内置投影。

## 常见问题的诊断路径

### 点击图标后没有任何请求

1. 看是否出现 `run.started`。
2. 没有：检查徽标是否为 `SET`，以及当前页面是否允许注入。
3. 有 `batch.received` 但没有请求：查看 `cache.resolved`；全命中不应调用 API。
4. `cacheMisses` 大于 0 但没有 `model.request.started`：查看同一 `runId` 的 `batch.failed` 和 `errorCode`。

### HTTP 401 或 403

- 确认 `provider`、`providerAdapter` 和 `apiHost` 是你申请 Key 的服务。
- 重新输入 API Key，不要把 Key 发给他人。
- Azure 还要核对“资源区域”是否与门户中的资源类型和区域一致。
- Google、Anthropic 或 OpenAI 的账户可能还需要开通 API、账单或对应模型权限。
- 自定义 OpenAI-compatible 服务还要确认 Base URL 与模型 ID，并允许 Chrome 访问该 API origin。

### HTTP 429

- 查看 `retryAfterMs`，等待而不是连续点击。
- 确认账户余额、每分钟请求/token 配额和并发限制。
- 用 `sourceCharacters` 与 `segmentCount` 判断批次是否过大。
- 同一请求最多三次尝试；失败后不会自动改用其他 Provider。

### 请求成功但页面没有译文

1. 如果有 `sdk.request-end` 但没有 `model.request.completed`，SDK 解析 Provider 响应失败。
2. 有 `model.request.completed` 但没有 `model.response.validated`，检查结束原因。
3. 有 `model.response.validated` 后出现 `batch.failed`，通常是模型 JSON、段落 ID、数量或译文长度校验失败。
4. 有 `batch.completed`，转到网页 DevTools 检查内容脚本和 DOM 插入。

### 事件突然从序号 1 重新开始

Chrome 可能终止并重新启动了空闲 Service Worker。比较 `workerInstanceId`；这符合 Manifest V3 生命周期。调试 Port 会自动重连并请求当前 session 快照。

## 三个 DevTools 上下文

| 要排查的部分 | 应打开的 DevTools |
| --- | --- |
| Service Worker 注册、Provider Network、缓存、重试 | `chrome://extensions` 中的 Service Worker DevTools |
| DOM 扫描、增量内容、译文插入 | 被翻译网页的 DevTools，切换到扩展内容脚本上下文 |
| 设置表单、模型下拉、调试面板渲染 | 设置页标签的 DevTools |

Chrome Network、Console 和 Extension Storage 是原始诊断面，不会自动脱敏。Network Headers 可能有 Key，Payload/Response 可能有正文和译文。不要分享 Copy as cURL、HAR、Storage 截图或原始请求。

## 调试存储与安全白名单

事件位于 `chrome.storage.session`：

- 最多 300 条。
- 总量约 512 KiB，超出时从最旧事件开始删除。
- 重新加载/停用/更新扩展或重启浏览器后会清空。
- 关闭“记录事件”会停止新增事件、撤销正文授权并清除既有 `requestPayload`；普通元数据事件仍保留，“清空事件”才会删除全部记录。

DeepSeek `messages` 可能比普通元数据大，因此开启请求正文记录后更容易触发 512 KiB 上限并淘汰旧事件。这个上限是容量保护，不是隐私清理机制；排查结束后仍应主动点击“清空”。

后台 `chrome-extension/background/debug-store.js` 的安全事件转换只复制明确列在 `constants.js` 中的字符串、数字和布尔字段。DeepSeek 的瞬时 `requestBody` 走单独的结构投影，只把允许的子字段重建为 `requestPayload`，不会原样复制任意 fetch 参数。添加调试字段时，应先回答：

1. 它是否可能包含 API Key、Cookie、Authorization、query token 或账户标识？
2. 如果它有意包含网页原文，是否要求用户在“记录事件”之外另行明示授权、排除无痕窗口，并在撤销任一授权时清除既有 payload？
3. 是否可以只保留完成诊断所需的固定子字段、数量、枚举、布尔值或哈希？
4. 是否有逐字段类型、长度、数组数量和总存储上限？
5. 是否有自动测试证明 API Key、Authorization、其他请求头和响应体没有进入 `debug-events-v1`？

任何无法明确证明边界的字段都不应加入白名单。警告和错误只记录数量或安全错误码，不记录 Provider 原文；DeepSeek 请求正文是经过结构投影、用户主动选择后才记录的窄例外。

## 相关文档

- [文档入口](./README.md)
- [代码地图](./codebase-map.md)
- [Chrome 扩展开发入门](./chrome-extension-basics.md)
- [固定模型目录与 Provider 架构](./provider-catalog.md)
- [Chrome 官方：Debug extensions](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug)
- [Chrome 官方：Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome 官方：Extension Storage](https://developer.chrome.com/docs/devtools/storage/extensionstorage)

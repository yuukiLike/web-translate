# 调试模式与请求诊断

调试模式回答的是“扩展正在做什么、请求到了哪里、为什么重试或失败”，不是抓包工具。它只保存经过白名单过滤的元数据，不保存网页正文、译文、API Key、请求头、请求体或响应体。

## 最快开始

1. 右键工具栏中的扩展图标。
2. 勾选“开发调试模式”。右键菜单会立即保存开关。
3. 再次右键并选择“打开详细调试面板”。
4. 回到网页点击扩展图标，或在设置页点击“测试当前服务”。
5. 按相同 `runId`、`requestId` 和 `attempt` 从上到下阅读事件。
6. 排查结束后关闭调试；需要删除已有记录时点击“清空事件”。

设置页里的“记录调试事件”复选框需要点击“保存设置”后才会改变后台记录状态。工具栏右键菜单的开关则立即生效。

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
| `sdk.request-start` | SDK fetch 层 | 显式 Provider 即将发出 HTTP 请求 |
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
| `providerAdapter` | 实际适配器，如 `@ai-sdk/openai` 或 `deepl-rest` |
| `apiHost` | allowlist 确定的 API 主机，不含 Key、查询参数或正文 |
| `model` | 设置中选择且已通过 allowlist 的模型 ID |
| `inferencePolicy` | 翻译请求采用的低推理策略，例如 `reasoning-none` 或 `thinking-minimal` |
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

调试面板只显示数量，不显示具体段落内容。

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
- 关闭调试只停止新增事件；“清空事件”才会删除已有记录。

后台 `createSafeDebugEvent()` 只复制明确列在 `DEBUG_STRING_FIELDS`、`DEBUG_NUMBER_FIELDS` 和 `DEBUG_BOOLEAN_FIELDS` 中的字段。添加调试字段时，应先回答：

1. 它是否可能包含 API Key、Cookie、Authorization、query token 或账户标识？
2. 它是否可能包含网页原文、译文、提示词、请求体或响应体？
3. 是否可以改成数量、枚举、布尔值、固定 host 或哈希？
4. 是否需要长度上限？
5. 是否有自动测试证明敏感测试值没有进入 `debug-events-v1`？

任何无法明确证明安全的字段都不应加入白名单。警告和错误只记录数量或安全错误码，不记录 Provider 原文。

## 相关文档

- [Chrome 扩展开发入门](./chrome-extension-basics.md)
- [固定模型目录与 Provider 架构](./provider-catalog.md)
- [Chrome 官方：Debug extensions](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug)
- [Chrome 官方：Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome 官方：Extension Storage](https://developer.chrome.com/docs/devtools/storage/extensionstorage)

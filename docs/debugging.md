# 调试模式与请求诊断

调试面板把一次 DeepSeek 网页翻译串成可检查的链路：页面任务 → 被选入翻译的原文块 → 去重分片与 DOM 目标 → 批次和缓存 → 实际 HTTP 请求。只有用户主动开启“记录事件”后，扩展才会把事件暂存在 `chrome.storage.session`；默认只含白名单元数据。再单独开启“原文与请求内容”，普通窗口中的 DeepSeek 翻译才会记录原文结构，以及发送时捕获的 `requestPayload` 安全投影。

`messages` 可能包含正在翻译的网页原文，因此“受控投影”只表示字段范围经过限制，不表示内容适合公开分享。内置日志始终不记录 API Key、Authorization、其他请求头、Provider 响应体或完整错误原文。

升级前只有 `debugLogging: true` 的设置不会自动获得正文授权：缺少 `debugRequestPayload` 时会按 `false` 处理。无痕窗口可以产生不含正文的调试元数据，但即使两个开关都开启，也永不捕获或暂存原文结构与请求正文。关闭“原文与请求内容”或关闭“记录事件”都会撤销正文授权，并从后台内存与 `chrome.storage.session` 的既有事件中移除原文、结构映射和 `requestPayload`；普通元数据事件仍会保留，直到点击“清空”或 session 生命周期结束。

“原文结构”只记录主框架中实际被选入翻译的正文块及其采集时的 DOM 路径，包含后续动态扫描。它不保存整页所有 DOM、被过滤元素及其过滤原因，也不证明译文最终已经插入页面。过滤逻辑或实际 DOM 写入仍需在被翻译网页的 DevTools 中排查。

## 最快开始

1. 点击工具栏中的扩展图标，打开 popup。
2. 点击“调试记录”，进入详细调试面板。
3. 主动开启“记录事件”。开关会立即保存，不需要再点击配置页的“保存并测试”；此时只记录元数据。
4. 需要检查原文与发送内容时，再单独开启“原文与请求内容”。
5. 回到普通窗口中的网页，点击 popup 右上方的“翻译 / 恢复”触发一次 DeepSeek 翻译。也可点击调试面板的“测试当前服务”，生成包含 `hello` 的请求样例；连接测试没有网页原文结构。
6. 默认“原文结构”视图中先选页面任务，再选原文块，查看完整标准化文本、DOM 路径和修订号。
7. 展开“翻译分片”，检查缓存去向、批次和对应的 DOM 位置列表；点击目标路径可跳到关联原文块。再在“实际发送”中展开关联请求，阅读 system/user 消息、参数或格式化 JSON。拆分恢复请求按层级缩进，并标明恢复深度。
8. 需要跨任务检查网络尝试时切到“HTTP 请求”；需要事件顺序或只排查失败时，分别切到“全部事件”或“错误”。
9. 排查结束后关闭“记录事件”；需要删除普通元数据事件时点击“清空”。

“记录事件”是独立保存的实时调试开关，也是正文授权的前置条件。关闭后会停止新增事件、断开实时连接、把“原文与请求内容”重置为关闭，并清除既有的原文结构和 `requestPayload`，包括当前已打开的详情与可复制内容；不含正文的普通元数据事件不会自动删除。要删除所有已有事件，再点击“清空”。

## 面板视图与操作

- **原文结构：** 默认视图按页面任务组织原文块，显示任务标题、地址、扫描次数，以及原文块、去重分片、批次和 HTTP 请求数量。选中正文块后，可沿 DOM 路径、修订、分片、缓存和实际发送记录查看关系。同一分片可以对应多个 DOM 位置；队列中被合并的重复分片会显示其共用的标识。
- **HTTP 请求：** 按真实 `requestId` 和 `attempt` 把同一次网络尝试的开始、完成或失败事件合并成一行，显示方法、主机、路径、HTTP 状态和耗时。网络重试、模型缩批恢复产生的请求分别保留，不把模型调用标识冒充实际 HTTP 请求标识。
- **全部事件：** “全部事件”保留内容采集、后台、缓存与 Provider 的受控事件顺序，适合沿 `runId` 查看扫描、批次、缓存、重试和用量。
- **错误过滤：** “错误”只显示 HTTP 状态不小于 400、带安全错误码，或状态为 `error` / `failed` 的行。
- **搜索：** 只搜索当前视图。“原文结构”支持任务标题、原文、DOM 路径和任务 ID；其他视图支持模型、端点、HTTP 状态、错误码以及受控元数据。
- **展开请求详情：** “请求上下文”列出该次尝试的元数据；“消息与分片”分别呈现实际 system/user 消息，并把合法 user JSON 中的 `segments` 展开为有序分片和语言方向，显示真实换行。另有“请求参数”和带行号的“请求 JSON”视图，以及原始消息文本入口。
- **仅在底部跟随：** HTTP 请求与事件列表位于底部时，新事件会自动滚动到最新位置。向上滚动会停止跟随，避免正在阅读的内容跳走；点击“继续跟随”会回到底部并恢复自动滚动。原文结构使用任务和节点选择，保留当前阅读位置。
- **明确完整性：** 没有捕获到正文时显示“未记录正文”；容量截断或存在未记录字段时显示“部分记录”，不会根据元数据重建正文。历史事件因总容量上限被淘汰时，页面显示淘汰数量；缺失扫描分包的任务也会标为不完整。
- **受控复制：** “复制原文”复制当前正文块；“复制请求 JSON”复制当前请求已捕获的安全投影，部分记录会明确提示；“复制当前视图”导出当前筛选结果及其受控关联数据。原文结构导出还包含保留范围、容量上限与淘汰数量，历史淘汰后会标记为部分记录。导出可能包含已授权的网页原文，分享前应检查并脱敏。

### 测试当前服务

“测试当前服务”会先校验并保存调试面板当前使用的 Provider 配置，再由后台发起真实请求：模型 Provider 和 Azure 使用一条很小的英译中测试，DeepL 查询用量端点。自定义服务会先请求当前 API origin 的 Chrome 权限。测试可能消耗 Provider 配额或产生少量费用。

开启“记录事件”后，这次测试会以元数据事件实时出现在“HTTP 请求”和“全部事件”中，可用于把 Provider 配置或网络问题与网页扫描、DOM 插入问题分开。如果当前服务是 DeepSeek，并且还单独开启了“原文与请求内容”，测试请求中的 `hello` 会作为可见的 `requestPayload` 样例；只开“记录事件”不会显示正文。测试成功只证明后台能够访问当前服务，不证明网页内容脚本能够扫描或写入当前页面。

## 一次 DeepSeek 模型翻译的正常事件顺序

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

开启内容记录后，初次和动态扫描还会产生 `content.planned`；动态重复分片与已排队分片合并时产生 `content.alias`。这些记录通过独立异步队列发送，不阻塞翻译，因此不应仅靠它们与批次事件的到达先后推断处理顺序，应使用下述关联标识。

Azure 和 DeepL 不经过 Vercel AI SDK，因此网络层事件仍使用原来的 `request.started`、`request.completed`、`request.failed` 和 `request.retry-scheduled`。

## 事件参考

| 事件 | 发生位置 | 含义 |
| --- | --- | --- |
| `settings.saved` | 设置页 → 后台 | 已保存规范化后的设置；不含 Key |
| `run.started` | 后台 | 当前标签页建立了固定设置快照 |
| `content.planned` | 内容脚本 → 后台 | 已选入翻译的原文、采集时 DOM 结构、分片及目标映射；需要独立内容授权 |
| `content.alias` | 内容脚本 → 后台 | 动态重复分片与已排队分片合并，记录 `segmentId → canonicalSegmentId` |
| `batch.received` | 后台 | 收到一批已验证的段落 |
| `cache.resolved` | 缓存 | 完成缓存命中/未命中统计 |
| `model.request.started` | 模型请求层 | 开始一次受扩展控制的尝试 |
| `sdk.request-start` | SDK fetch 层 | 显式 Provider 即将发出 HTTP 请求；只有普通窗口、DeepSeek 且两个调试开关均开启时，才会附带安全 `requestPayload` 投影 |
| `sdk.request-end` | SDK fetch 层 | 收到 HTTP 响应；非 2xx 也会出现此事件 |
| `sdk.request-error` | SDK fetch 层 | fetch 在拿到 HTTP 响应前失败或被取消 |
| `model.request.completed` | 模型请求层 | SDK 返回统一结果 |
| `model.request.failed` | 模型请求层 | 本次尝试失败；查看状态、错误码和可重试标记 |
| `model.request.retry-scheduled` | 模型请求层 | 后台已安排退避重试 |
| `model.response.validated` | 模型响应层 | 已通过结束原因、JSON、译文数量和 ID 校验 |
| `model.response.invalid` | 模型响应层 | 正常结束但格式或 ID 校验失败，正在有界缩批恢复 |
| `model.response.truncated` | 模型响应层 | 输出被截断，正在有界缩批恢复 |
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
| `scanId` / `chunkIndex` / `chunkCount` | 同一次初始或动态扫描及其分包；与 `runId` 一起重组原文记录，缺包表示记录不完整 |
| `nodeId` / `revision` | 运行内的 DOM 节点身份及该节点文本修订；原文节点记录中的字段名为 `id`，分片目标使用 `nodeId` |
| `segmentId` / `canonicalSegmentId` | 翻译分片及其合并后的规范标识；分片记录中的字段名为 `id` |
| `targets[].nodeId` / `partIndex` / `partCount` | 分片对应的 DOM 位置及其在源块中的顺序；一个分片可以有多个目标 |
| `batchId` | 后台收到并处理的一批分片 |
| `modelRequestId` | 一次模型调用组，与实际 SDK 网络请求分开 |
| `parentModelRequestId` / `recoveryDepth` | 格式或截断恢复时的父调用和拆分层级 |
| `segmentIds` / `rootSegmentIds` | 当前调用使用的分片标识，以及恢复拆分前的原始分片标识；用于把恢复请求关联回原文 |
| `requestId` | 实际 SDK HTTP 请求或 Azure/DeepL REST 请求的标识 |
| `attempt` | 当前重试尝试，从 1 开始 |

`workerInstanceId` 变化说明 Chrome 重新启动了 Service Worker，不一定是错误。同一个 `runId` 下可能有多个批次、模型调用、网络尝试和恢复调用。先用节点与分片标识定位原文，再用 `batchId`、`modelRequestId`、`rootSegmentIds` 和真实 `requestId` 检查具体发送，避免只按时间把无关请求拼在一起。

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
| `cacheHitIds` / `cacheMissIds` | 持久缓存命中与未命中的分片标识，可关联回原文 |
| `batchIndex` / `batchCount` | 事件提供时的批次位置；动态无限滚动时总数可能未知 |
| `queueDepth` | 事件提供时等待处理的请求数 |

批次与缓存事件记录数量和分片标识。开启“原文与请求内容”后，“原文结构”使用这些标识连接已采集的原文和请求，区分本次页面缓存、持久缓存、等待发送和已发送。全部命中缓存的分片没有新的模型请求；若较早事件已被淘汰，缺少关联请求并不等于实际没有发送。

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

网络层仅自动重试网络错误、超时及有限的 `408/429/5xx` 状态，每个请求最多三次尝试。Vercel AI SDK 的内部重试被关闭。模型响应层另有格式/截断恢复：一个原始批次共用两次二分预算，至多生成五个请求组，各组仍遵守网络尝试上限。预算耗尽后停止，不修补或缓存非法译文；恢复失败或取消也计入已发生用量。

### DeepSeek 请求正文安全投影

`src/provider/observed-fetch.js` 会在本次函数调用期间把 SDK 交给 `fetch` 的 JSON 字符串命名为 `requestBody`。后台通过 `request-payload-sanitizer.js` 生成 `sdk.request-start.requestPayload` 的安全投影。Options 的 `createRequestCapture` 复用同一转换规则，合并保存时的截断和遗漏标记，没有第二份易漂移的白名单或额外的 40k 字符截断。它来自实际发送的正文，不是后台 Provider 参数对象，也不是按提示词模板重建的示例。

| 字段 | 含义 | 隐私提醒 |
| --- | --- | --- |
| `requestPayload.model` | 实际发送给 DeepSeek 的模型 ID；最长 300 字符 | 不含凭据 |
| `requestPayload.max_tokens` | 本批请求的最大输出 token，保存为非负整数 | 不含正文 |
| `requestPayload.messages[].role/content` | SDK 转换后的 system/user messages；最多 32 条，整个投影受 256 KiB 上限约束 | user message 可能包含网页原文；system message 包含翻译约束 |
| `requestPayload.thinking.type` | DeepSeek thinking 配置；翻译请求为 `disabled` | 不含正文 |
| `requestPayload.temperature/top_p/frequency_penalty/presence_penalty` | 实际出现且通过类型校验的采样参数 | 不含正文 |
| `requestPayload.reasoning_effort/stream/response_format.type/stop` | 实际出现且在共享规则中允许的请求参数 | `stop` 是请求内容的一部分；不会据配置猜测缺失值 |
| `requestPayloadTruncated` | 字段被缩短、转换或消息因数量/容量上限被截断时为 `true` | 不应把缺少的内容误判为实际未发送 |
| `requestPayloadOmittedFields` | 未记录的字段路径；未知字段名规范化为 `other_field`，避免字段名本身泄露内容 | 有遗漏时显示“部分记录”，不把投影冒充完整原始 body |

投影不会保存 `Authorization`、API Key、User-Agent 等请求头，也不会保存 DeepSeek 响应体。若请求不是 DeepSeek、“记录事件”或“原文与请求内容”任一未开启、请求来自无痕窗口，或 body 不能通过结构校验，则事件中不会出现 `requestPayload`。旧版只有 `debugLogging` 的设置同样不满足正文授权。详情明确区分 `missing`、`partial` 和 `complete`；这里的完整性针对捕获规则所保留的数据。三层参数如何转换的完整示例见 [DeepSeek 请求实例：从后台参数到 HTTP Body](./provider-catalog.md#deepseek-请求实例从后台参数到-http-body)。

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

`responseModel` 与设置中的 `model` 不同不一定代表错误，Provider 可能返回版本化名称；应结合 Provider 官方控制台确认。`finishReason: length` 表示输出达到上限，扩展会拒绝不完整译文并进入有界缩批恢复；预算耗尽后才返回失败。

## 查看、复制与清空 DeepSeek 请求正文

### 在内置日志中查看

1. 点击扩展图标，在 popup 中选择“调试记录”。
2. 先开启“记录事件”，再单独开启“原文与请求内容”。两个开关都会立即保存；开启前已经发生的请求不会补记正文。
3. 点击“测试当前服务”生成包含 `hello` 的可见样例，或通过 popup 在普通窗口翻译当前网页。无痕窗口永不捕获正文。
4. 在“原文结构”中选择正文块并展开关联请求；也可切到“HTTP 请求”，按 `api.deepseek.com`、`chat/completions` 或 `sdk.request-start` 筛选。
5. 展开请求后先检查捕获状态。在“消息与分片”查看实际消息与换行，在“请求参数”检查模型与推理参数，在“请求 JSON”检查格式化投影。“部分记录”会列出截断或未记录字段，不能据此认定遗漏内容没有发送。
6. 点击详情中的“复制请求 JSON”复制该次捕获；需要多条数据时，先缩小筛选范围，再点击“复制当前视图”。复制结果可能包含网页原文，分享前删除或替换正文内容。
7. 排查完成后关闭“记录事件”。这会撤销正文授权并清除既有原文结构和 `requestPayload`，但保留普通元数据；要让列表完全为空，再点击“清空”。

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
2. 有 `model.request.completed` 但没有 `model.response.validated`，查看 `model.response.invalid` 或 `model.response.truncated`；它们表示格式异常或截断正在自动恢复。预算耗尽会出现 `batch.failed`。
3. 有 `model.response.validated` 后出现 `batch.failed`，JSON、段落 ID 和数量已经通过，继续检查译文长度、取消或后续处理错误。
4. 响应校验事件按 `runId`、`batchId` 和 `modelRequestId` 追踪；`parentModelRequestId`、`recoveryDepth` 与 `rootSegmentIds` 可将拆分恢复关联回原文。缺少真实 `requestId` 时，不把模型事件并入无关网络尝试。
5. 有 `batch.completed`，转到网页 DevTools 检查内容脚本和 DOM 插入。

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

- 最多 600 条事件；总存储预算为 4,000,000 个估算字节。超出任一限制时，从最旧事件开始淘汰。
- DeepSeek 单次请求投影最多 256 KiB、32 条 messages；超限会标记截断。
- 内容脚本按 192 KiB 预算发送扫描分包，后台单个结构记录预算为 512 KiB。`scanId` 与分包序号用于重组，缺失分包会在任务上提示。
- 单个源块或分片文本最多保留 50,000 个字符，发送侧另有 96 KiB 编码预算；任一限制导致截短都会标记。普通大小的正文保留完整标准化文本，不用列表摘要替代。
- 重新加载/停用/更新扩展或重启浏览器后会清空。
- 关闭“记录事件”会停止新增事件、撤销正文授权并清除既有原文、结构映射和 `requestPayload`；普通元数据事件仍保留，点击“清空”才会删除全部记录。

原文与请求投影比普通元数据大，开启后更容易达到总存储上限。后台保存累计淘汰事件数，面板明确提示只展示仍保留的数据；较早任务可能缺少节点、扫描分包、批次或请求，不能当作完整历史。清空记录会同时重置淘汰计数。

后台 `chrome-extension/background/debug-store.js` 通过 `debug-event-sanitizer.js` 转换事件，仅复制明确允许的标量和关联标识。DeepSeek 的瞬时 `requestBody` 走共享请求投影；页面原文和结构走单独的 `content-trace-sanitizer.js`，并校验主框架、当前任务和有效正文授权。不会原样复制任意 fetch 参数或任意 DOM 对象。添加调试字段时，应先回答：

1. 它是否可能包含 API Key、Cookie、Authorization、query token 或账户标识？
2. 如果它有意包含网页原文，是否要求用户在“记录事件”之外另行明示授权、排除无痕窗口，并在撤销任一授权时清除既有 payload？
3. 是否可以只保留完成诊断所需的固定子字段、数量、枚举、布尔值或哈希？
4. 是否有逐字段类型、长度、数组数量和总存储上限？
5. 是否有自动测试证明 API Key、Authorization、其他请求头和响应体没有进入 `debug-events-v1`？

任何无法明确证明边界的字段都不应加入白名单。警告和错误只记录数量或安全错误码，不记录 Provider 原文；页面原文结构和 DeepSeek 请求正文是经过结构投影、用户主动选择后才记录的例外。

## 相关文档

- [文档入口](./README.md)
- [代码地图](./codebase-map.md)
- [Chrome 扩展开发入门](./chrome-extension-basics.md)
- [固定模型目录与 Provider 架构](./provider-catalog.md)
- [Chrome 官方：Debug extensions](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug)
- [Chrome 官方：Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome 官方：Extension Storage](https://developer.chrome.com/docs/devtools/storage/extensionstorage)

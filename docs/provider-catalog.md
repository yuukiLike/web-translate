# 固定模型目录与 Provider 架构

本扩展不会在运行时下载模型目录或执行远程代码。开发者先把 models.dev 的一个固定版本裁剪为本地 snapshot，再经过 JSON Schema 和人工 allowlist 校验，最后把目录与显式 Vercel AI SDK Provider 一起打包进扩展。

```text
固定 models.dev commit
  → data/models-dev-subset.json
  → JSON Schema 本地校验
  → config/provider-allowlist.json
  → 显式 @ai-sdk/* Provider
  → Provider 官方 API
```

## 当前推荐顺序

以下价格是当前本地 snapshot 记录的每 100 万 token 美元价格，不是实时报价。模型可用性、免费层、区域和账户配额始终以 Provider 控制台为准。

| 顺序 | Provider / 模型 | snapshot 输入 / 输出 | 推荐用途 |
| --- | --- | ---: | --- |
| 1 | DeepSeek `deepseek-v4-flash` | $0.14 / $0.28 | 默认选择；当前四个候选中成本最低，翻译时关闭 thinking |
| 2 | OpenAI `gpt-5.6-luna` | $0.20 / $1.20 | 稳定、高吞吐；显式关闭 reasoning |
| 3 | Google `gemini-3.5-flash-lite` | $0.30 / $2.50 | thinking 使用模型支持的最低 `minimal`；免费层资格可能变化 |
| 可选 | Anthropic `claude-sonnet-5` | $2.00 / $10.00 | 质量对照；显式关闭 reasoning |

前三个是产品推荐，不是自动故障转移链。扩展只调用用户当前选择并配置了 API Key 的 Provider，不会在失败后把正文悄悄发送给另一家公司。

Azure Translator 和 DeepL 仍然可用，但它们是专用翻译 API，不属于本地模型 snapshot，也不经过 Vercel AI SDK。

## 为什么采用固定 snapshot

运行时动态读取“所有模型”看似方便，但会引入几个不确定因素：目录字段可能变化、模型可能被下线、API 地址可能被错误或恶意改写、同一个扩展版本在不同日期会出现不同配置。

固定 snapshot 带来的边界是：

- 同一扩展版本始终看到相同 Provider、模型、成本元数据和 API 地址。
- Chrome 不需要 `models.dev` host permission，也不需要任意 HTTPS 的可选权限。
- 模型目录变更会形成可审查的 Git diff。
- schema、allowlist、生成产物和测试能在发布前一起失败，而不是在用户浏览网页时才失败。

models.dev 在这里仍然是上游数据源，但不是运行时依赖。当前 snapshot 固定到 commit：

```text
141191529fcad56200de45e7267a21dffcc4c33e
```

## 文件职责

| 文件 | 职责 | 是否手工维护 |
| --- | --- | --- |
| `data/models-dev-subset.json` | 固定上游模型元数据 | 是，更新时审查 |
| `schemas/model-catalog.schema.json` | snapshot 结构约束 | 是 |
| `config/provider-allowlist.json` | 可实际调用的 Provider、SDK 包、官方 API 和默认模型 | 是，安全敏感 |
| `schemas/provider-allowlist.schema.json` | allowlist 结构约束 | 是 |
| `scripts/validate-provider-config.mjs` | schema 与跨文件不变量校验 | 是 |
| `src/provider-runtime.js` | 四个显式 Provider 的统一调用层 | 是 |
| `scripts/build-provider-runtime.mjs` | 校验后生成浏览器脚本并打包 SDK | 是 |
| `lib/provider-catalog.generated.js` | 设置页、内容脚本和后台使用的只读目录 | 否，生成文件 |
| `lib/provider-runtime.js` | Service Worker 使用的压缩 Provider bundle | 否，生成文件 |

安装扩展的普通用户不需要运行 npm，也不会下载本地翻译模型。只要仓库已经包含两个 `lib/*.generated/runtime.js` 产物，Chrome 可以直接“加载已解压的扩展程序”。npm 依赖只用于开发者更新目录或重新打包 SDK。

## allowlist 实际允许什么

| Provider ID | 显式 SDK | 固定 API Base URL |
| --- | --- | --- |
| `deepseek` | `@ai-sdk/deepseek` | `https://api.deepseek.com` |
| `openai` | `@ai-sdk/openai` | `https://api.openai.com/v1` |
| `google` | `@ai-sdk/google` | `https://generativelanguage.googleapis.com/v1beta` |
| `anthropic` | `@ai-sdk/anthropic` | `https://api.anthropic.com/v1` |

校验器还会确认：

- snapshot commit 必须等于代码固定的 40 位 SHA。
- 四个 Provider 必须各出现一次，不能多也不能少。
- 每个模型的 `providerId` 必须与父 Provider 一致。
- 默认模型必须真实存在于对应 snapshot。
- SDK 包名不能换成 `@ai-sdk/openai-compatible`。
- API Base URL 必须等于代码维护的官方地址，不能由配置随意改写。
- 模型必须支持文本输出，能力、成本、上下文和日期字段必须符合 schema。

运行时还会再次检查 `providerId + modelId` 组合；不在 allowlist 的值会在网络请求前被拒绝。

## 更新 snapshot 的操作指南

### 1. 确认上游版本

选择一个明确的 models.dev Git commit，记录其完整 SHA。不要把 `main`、`latest` 或只含日期的 URL 当作可复现版本。

### 2. 更新本地数据

只把准备支持的 Provider 和模型写入 `data/models-dev-subset.json`。同时更新：

- `source.commit`
- `source.fetchedAt`
- 模型标识、发布时间、成本、上下文、能力和输入输出模态

如果 Provider、官方 API 或默认模型改变，再审查并更新 `config/provider-allowlist.json` 以及校验器中的固定映射。不要只为了让校验通过而放宽 schema 或 URL 约束。

### 3. 安装精确依赖

使用 Node.js 22+，从扩展目录执行：

```bash
npm install --ignore-scripts
```

直接依赖均使用精确版本；`package-lock.json` 也应随依赖更新一起审查。

### 4. 先校验，再生成

```bash
node scripts/validate-provider-config.mjs
node scripts/build-provider-runtime.mjs
```

生成脚本会再次执行校验。任何 schema 或跨文件不变量失败都会阻止写出新 bundle。

### 5. 运行完整离线检查

```bash
npm run check
```

`npm run check` 会在内存中按同一配置重新生成目录脚本与 SDK bundle；只要已提交的 `lib/` 产物与 snapshot、allowlist、源码或构建配置不一致，检查就会失败。生产 bundle 在任何 SDK schema 解析前预设 Zod `jitless`，避免 Manifest V3 CSP 环境触发动态 `Function` 能力探测。

测试不会调用真实 Provider，也不需要 API Key。它会验证 schema、allowlist、生成的全局目录、非法 Provider 拒绝、四家 SDK 的官方 endpoint 与低推理请求参数、调试脱敏和 DOM 增量翻译契约。

### 6. 检查生成差异并重新加载

确认以下内容符合预期：

- 没有意外增加 Provider 或 API 域名。
- 推荐模型与默认模型一致。
- `manifest.json` 只声明固定官方 host permissions。
- 生成文件不包含真实 API Key。

随后在 `chrome://extensions` 重新加载扩展，并刷新测试网页。

## Provider runtime 的统一接口

后台只调用一个本地全局接口：

```js
globalThis.BilingualTranslatorProviderRuntime.generateTranslation({
  providerId,
  apiKey,
  modelId,
  messages,
  abortSignal,
  maxOutputTokens,
  onRequestEvent,
});
```

返回值统一为文本、标准/原始结束原因、响应 ID、实际响应模型、token 明细和警告数量。Provider 原始响应不会写入调试存储。

SDK 内部重试固定为 `0`。扩展后台统一处理超时、最多三次尝试和 `Retry-After`，避免 SDK 与业务层叠加重试造成额外成本。DeepSeek 关闭 thinking；OpenAI 和 Anthropic 使用 `reasoning: none`；Gemini 3.5 使用其支持的最低 `minimal` thinking。

## 安全与隐私边界

- Provider 代码随扩展打包；不从 CDN 或目录站点下载 JavaScript。
- API Key 只传给当前选中的显式 Provider。
- 调试 callback 只能输出方法、无查询参数的 endpoint、HTTP 状态、耗时和可重试标记。
- 网页正文和译文不会进入 catalog、allowlist 或调试事件。
- 生成 bundle 是代码依赖，应和源文件、lockfile 一起审查。

## 官方资料

- [models.dev 数据与源码](https://github.com/anomalyco/models.dev)
- [Vercel AI SDK：生成文本](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [Vercel AI SDK：OpenAI Provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)
- [Vercel AI SDK：DeepSeek Provider](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)
- [Vercel AI SDK：Google Provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai)
- [Vercel AI SDK：Anthropic Provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
- [DeepSeek API 更新记录](https://api-docs.deepseek.com/updates/)
- [OpenAI 模型目录](https://developers.openai.com/api/docs/models)
- [Gemini API 定价](https://ai.google.dev/gemini-api/docs/pricing)

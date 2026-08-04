# Bilingual Translate for Raycast

Raycast 本地扩展。在浏览器之外读取前台应用的选中文本；没有可读选区时自动回退到剪贴板，然后通过用户自己的翻译 API Key 完成中英互译。

当前版本：`0.1.0`。

扩展不会下载本地中英模型。首次使用只需配置一个所选云 Provider 的 API Key。

## 功能

| 命令                          | 行为                                          |
| ----------------------------- | --------------------------------------------- |
| Translate Text                | 手动输入文字，在 Raycast 中上下展示原文和译文 |
| Translate Selection           | 翻译前台应用选区；没有选区时读取剪贴板        |
| Translate Selection and Copy  | 翻译选区或剪贴板，并只复制译文                |
| Translate Selection and Paste | 翻译选区，并把译文粘贴回原应用                |
| Translation Diagnostics       | 查看或清除脱敏请求诊断事件                    |

所有命令共用同一组 Provider、API Key、翻译方向、缓存和调试设置。

## 本地安装

前置条件：

- macOS 上已安装 [Raycast](https://www.raycast.com/)
- Node.js `22.22.2` 或更高版本

在仓库根目录的终端运行：

```bash
cd raycast-extension
nvm install  # 仅在使用 nvm 且本机尚无 Node 22.22.2+ 时需要
nvm use
npm install --ignore-scripts
npm run dev
```

不使用 nvm 时，只需确认 `node --version` 不低于 `22.22.2`。

`ray develop` 会构建并自动把本地扩展导入 Raycast。开发时保持这个终端运行；修改源码后会自动重新加载，不需要反复手工导入。

第一次运行任一命令前：

1. 打开 Raycast Settings。
2. 进入 Extensions，找到 Bilingual Translate。
3. 选择 Provider。
4. 只填写当前 Provider 对应的 API Key。
5. 选择自动、中译英或英译中。

各 Provider 的 Key 相互独立。Chrome 扩展和 Raycast 扩展使用不同的本地设置，API Key 不会自动互相复制。

## 日常使用

最省摩擦的方式：

1. 在任意应用中选中英文或中文。
2. 呼出 Raycast。
3. 运行 `Translate Selection and Copy`，或给它设置一个 Raycast Hotkey。
4. 需要直接替换选区时运行 `Translate Selection and Paste`。

若应用不允许 Raycast 读取选区，扩展会读取当前剪贴板。若直接粘贴首次触发 macOS 权限提示，只授予 Raycast 完成该操作所需的系统权限即可。

## Provider

模型 Provider 使用仓库根目录的固定 models.dev snapshot 和人工 allowlist：

| 顺序 | Provider / 模型                | 用途                            |
| ---- | ------------------------------ | ------------------------------- |
| 1    | DeepSeek `deepseek-v4-flash`   | 默认，低成本，关闭 thinking     |
| 2    | OpenAI `gpt-5.6-luna`          | 稳定、高吞吐，`reasoning: none` |
| 3    | Google `gemini-3.5-flash-lite` | 高吞吐，最低 thinking           |
| 可选 | Anthropic `claude-sonnet-5`    | 质量对照，`reasoning: none`     |

也支持 Azure Translator 和 DeepL 专用翻译 API。扩展不会在 Provider 之间静默切换，避免在用户不知情时把文本发送到另一家公司。

Azure Resource Region 不是目标语言。全局 Translator 单服务资源通常留空；区域性或多服务资源填写 Azure 门户显示的资源区域，例如 `eastasia`。

## 缓存、成本和隐私

- 翻译结果按 Provider、模型、方向和文本摘要隔离，保存在 Raycast 的 10 MB LRU Cache 中，90 天后失效。
- 相同输入命中缓存时不会再次调用 API。
- 模型 SDK 的内部重试关闭，由扩展统一执行有限重试，避免双重请求成本。
- API Key 使用 Raycast `password` preference，不写入源码、缓存或调试记录。
- Provider 只收到用户选中、复制或手动输入的纯文本。
- 调试记录不保存原文、译文、请求头、请求体、响应体、API Key 或完整 Provider 错误。

## 调试

在扩展设置中开启 Debug Mode，再运行 `Translation Diagnostics`。面板显示：

- Raycast 扩展版本、Raycast 版本和 models.dev snapshot SHA
- Provider、模型、语言方向和缓存命中情况
- 请求状态、耗时、尝试次数、错误分类
- 输入、输出、cache-read token 或计费字符

事件是有界的本地记录，可从诊断命令清除。关闭 Debug Mode 后不再新增事件。

开发模式的终端会显示 Raycast 自身的构建错误；扩展业务诊断应以脱敏面板为准。

## 目录和数据流

```text
前台应用选区 ─┐
剪贴板回退 ───┼→ 输入规范化与自动语言方向
手动输入 ─────┘       ↓
              90 天本地缓存
                     ↓ miss
固定 snapshot → allowlist → 显式 Provider adapter → 云 API
                     ↓
             Raycast Detail / Copy / Paste / HUD
```

主要文件：

- `package.json`：Raycast manifest、命令和密码偏好设置
- `scripts/sync-catalog.mjs`：从仓库根目录生成类型安全模型目录
- `src/generated/provider-catalog.ts`：生成产物，不直接编辑
- `src/lib/`：方向判断、Provider、重试、缓存和脱敏诊断
- `src/components/translation-view.tsx`：双语结果展示与操作
- `src/translate-*.ts(x)`：五个 Raycast 命令入口

固定目录的数据来源仍是：

```text
../data/models-dev-subset.json
../config/provider-allowlist.json
```

更新根目录 snapshot 或 allowlist 后运行：

```bash
npm run sync:catalog
```

## 开发验证

```bash
npm run check
npm run build
```

`npm run check` 执行固定目录校验、生成产物一致性检查、Raycast lint、TypeScript 类型检查和不调用真实 API 的单元测试。`npm run build` 把可发布构建写入 `dist/`。

普通验证不需要 API Key，也不会产生付费请求。真实 Provider 验证只应使用你明确选择的账户和少量测试文本。

官方资料：

- [Raycast Manifest](https://developers.raycast.com/information/manifest)
- [读取选中文本](https://developers.raycast.com/api-reference/environment)
- [Clipboard API](https://developers.raycast.com/api-reference/clipboard)
- [Preferences](https://developers.raycast.com/api-reference/preferences)
- [本地存储与 Cache](https://developers.raycast.com/api-reference/storage)
- [开发 CLI](https://developers.raycast.com/information/developer-tools/cli)
- [调试扩展](https://developers.raycast.com/basics/debug-an-extension)

# 开发说明

目标是一个极简、稳定的中英翻译工具。使用方法见[项目 README](../README.md)。

## 构建

使用 Node.js 24 与 npm，沿用仓库的 `package-lock.json`。

```sh
npm ci --ignore-scripts
npm run build:chrome
```

加载目录是 `chrome-extension/`。源码修改后重新构建、重新加载扩展，再刷新网页。构建成功不代表已经通过实际网站验证。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `src/content/` | 正文扫描、动态内容监听、译文展示与恢复 |
| `src/content/selection/` | 选区快照、用户选择事件、浮层定位、请求和朗读生命周期 |
| `chrome-extension/background/` | 服务请求、任务取消、权限、设置与缓存 |
| `src/core/` | 中英方向、文本切分、设置与响应校验 |
| `src/popup/`、`src/options/` | 日常操作与设置 |
| `chrome-extension/speech/`、`tools/edge-tts/` | 系统语音与可选 Edge TTS 播放 |

## 维护约束

- 优先修正明确的问题；沿现有路径修改，先处理异常，避免重复状态与额外功能。
- 原文和译文只按文本处理。选区先保存再打开浮层；每个异步结果必须属于当前任务。
- 关闭、恢复和导航必须释放请求、监听器、定时器及音频。失败不能伪装成完成，也不能无休止自动重试。
- 设置和令牌只经过扩展的可信上下文。站点规则集中在 `src/content/site-profile.js`。
- `chrome-extension/generated/`、popup 和 options 的打包 JS/CSS 由构建脚本生成，不手改。
- 验证方式遵守[仓库规则](../AGENTS.md)和当前用户要求；没有证据时不声称网站已通过验收。

# 项目文档入口

本目录只描述 Chrome 扩展。第一次接手项目时，不要从生成后的压缩 JavaScript 开始读；先用下面的顺序建立全局认识，再进入具体模块。

## 推荐阅读顺序

1. [代码地图](./codebase-map.md)：先知道每个目录、每个手写文件负责什么，以及点击图标后代码如何流动。
2. [Chrome 扩展开发入门](./chrome-extension-basics.md)：亲手加载扩展，并理解 popup、Manifest V3、权限、运行上下文和调试入口。
3. [调试模式与请求诊断](./debugging.md)：查看用户主动开启后暂存的事件和 DeepSeek 请求正文投影；遇到“没有请求、没有译文、重试或报错”时按事件链定位问题。
4. [固定模型目录与 Provider 架构](./provider-catalog.md)：理解后台参数如何经过 AI SDK 变成 DeepSeek HTTP body；需要改 Provider、模型、allowlist、价格元数据或生成流程时再深入阅读。

## 每个文件分别做什么

| 文档 | 用途 | 适合谁 | 什么时候读 |
| --- | --- | --- | --- |
| [`README.md`](./README.md) | 当前索引；说明每份文档的用途、推荐阅读顺序和按任务选择入口 | 所有读者 | 不知道下一份该读什么时 |
| [`codebase-map.md`](./codebase-map.md) | 逐目录、逐手写文件解释职责、依赖方向、生成文件和完整翻译调用链 | 完全不了解项目的新开发者、代码审查者 | 第一份读；改代码前先确认模块边界 |
| [`chrome-extension-basics.md`](./chrome-extension-basics.md) | 从加载扩展开始，解释 Chrome 的 popup、Service Worker、内容脚本、设置页、权限和 DevTools | 第一次开发 Chrome 扩展的人 | 需要运行项目、理解浏览器上下文时 |
| [`debugging.md`](./debugging.md) | 解释受控事件、DeepSeek 请求正文投影、复制/清空、Network 交叉验证和常见故障诊断路径 | 开发者、测试人员、排查 Provider 问题的人 | 需要核对实际请求、重试、无请求或无译文时 |
| [`provider-catalog.md`](./provider-catalog.md) | 解释固定 models.dev snapshot、JSON Schema、allowlist、SDK runtime、价格元数据、DeepSeek 三层请求转换和更新流程 | 维护 Provider、模型、目录数据或构建安全边界的人 | 修改模型、价格、API 地址、依赖或目录数据前 |
| [`x-hover-rendering-postmortem.md`](./x-hover-rendering-postmortem.md) | 记录 X hover fresh 节点替换导致布局跳动的根因、失败方案、最终状态迁移设计，以及相邻 HN 布局契约 | 内容脚本维护者、DOM/SPA 故障排查者 | 修改 X 站点策略、generated presentation、MutationObserver、虚拟列表或 HN 标题布局前 |

## 按任务选择

- 只想安装并使用：读根目录 [`README.md`](../README.md) 的“安装与首次使用”。
- 想修改网页扫描或缓存：读 [`codebase-map.md`](./codebase-map.md) 的 `src/content/`、`src/core/` 与调用链。
- 想拆分或理解后台：读 [`codebase-map.md`](./codebase-map.md) 的 `chrome-extension/background/`。`service-worker.js` 只是极薄装配入口，不处理 action 点击。
- 想理解点击图标后为什么先出现 popup：读 [`chrome-extension-basics.md`](./chrome-extension-basics.md) 的 action、popup 与消息传递章节。
- 想核对 DeepSeek 实际收到什么：先读 [`provider-catalog.md`](./provider-catalog.md) 的完整案例，再按 [`debugging.md`](./debugging.md) 查看本机日志或 Service Worker Network。
- 想修改模型价格展示：读 [`provider-catalog.md`](./provider-catalog.md) 的价格 snapshot、schema 和更新流程。
- 想改设置页但保持现有 UI：先读根目录 [`DESIGN.md`](../DESIGN.md)，再看代码地图中的 `src/options/`。
- 想增加测试：看代码地图的 `test/` 分层；所有 `test(...)` 前都必须有紧邻的中文意图注释。
- 想排查 X hover、虚拟列表或 fresh DOM replacement：先读 [`x-hover-rendering-postmortem.md`](./x-hover-rendering-postmortem.md)，再看其中链接的 replacement 与 lifecycle 回归。
- 想修改 Hacker News 标题换行、来源站点同行延续或元信息过滤：读同一份复盘的“Hacker News 相邻回归”，再对照代码地图中的站点策略与 HN 集成测试。

## 文档维护规则

- `src/**` 和 `chrome-extension/background/**` 是手写源码，文档应引用它们说明行为。
- `chrome-extension/generated/*.js`、`chrome-extension/options/options.{js,css}` 与 `chrome-extension/popup/popup.{js,css}` 是构建产物，只用于说明 Chrome 实际加载什么，不应作为可编辑源码指导读者。`chrome-extension/popup/index.html` 仍是手写入口。
- 文件重命名、消息协议或构建脚本改变时，应同步更新本索引、代码地图和受影响的专题文档。
- 修改 X 的 `generated` 呈现、replacement key、MutationObserver 边界、停止清理或 HN `line-start-inline` 契约时，应同步更新故障复盘中的“最终设计”“回归保护”和“当前设计边界”；已经发生的排查阶段与用户验收记录保持不变。

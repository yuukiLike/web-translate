# 项目文档入口

本目录只描述 Chrome 扩展。第一次接手项目时，不要从生成后的压缩 JavaScript 开始读；先用下面的顺序建立全局认识，再进入具体模块。

## 推荐阅读顺序

1. [代码地图](./codebase-map.md)：先知道每个目录、每个手写文件负责什么，以及点击图标后代码如何流动。
2. [Chrome 扩展开发入门](./chrome-extension-basics.md)：亲手加载扩展，并理解 Manifest V3、权限、运行上下文和调试入口。
3. [调试模式与请求诊断](./debugging.md)：遇到“没有请求、没有译文、重试或报错”时，按事件链定位问题。
4. [固定模型目录与 Provider 架构](./provider-catalog.md)：需要改 Provider、模型、SDK、allowlist 或生成流程时再深入阅读。

## 每个文件分别做什么

| 文档 | 用途 | 适合谁 | 什么时候读 |
| --- | --- | --- | --- |
| [`codebase-map.md`](./codebase-map.md) | 逐目录、逐手写文件解释职责、依赖方向、生成文件和完整翻译调用链 | 完全不了解项目的新开发者、代码审查者 | 第一份读；改代码前先确认模块边界 |
| [`chrome-extension-basics.md`](./chrome-extension-basics.md) | 从加载扩展开始，解释 Chrome 的 Service Worker、内容脚本、设置页、权限和 DevTools | 第一次开发 Chrome 扩展的人 | 需要运行项目、理解浏览器上下文时 |
| [`debugging.md`](./debugging.md) | 解释脱敏事件、请求视图、错误字段和常见故障诊断路径 | 开发者、测试人员、排查 Provider 问题的人 | 出现错误、重试、无请求或无译文时 |
| [`provider-catalog.md`](./provider-catalog.md) | 解释固定 models.dev snapshot、JSON Schema、allowlist、SDK runtime 和更新流程 | 维护 Provider、模型或构建安全边界的人 | 修改模型、API 地址、依赖或目录数据前 |

## 按任务选择

- 只想安装并使用：读根目录 [`README.md`](../README.md) 的“安装与首次使用”。
- 想修改网页扫描或缓存：读 [`codebase-map.md`](./codebase-map.md) 的 `src/content/`、`src/core/` 与调用链。
- 想拆分或理解后台：读 [`codebase-map.md`](./codebase-map.md) 的 `chrome-extension/background/`。`service-worker.js` 只是 20 行装配入口。
- 想改设置页但保持现有 UI：先读根目录 [`DESIGN.md`](../DESIGN.md)，再看代码地图中的 `src/options/`。
- 想增加测试：看代码地图的 `test/` 分层；所有 `test(...)` 前都必须有紧邻的中文意图注释。

## 文档维护规则

- `src/**` 和 `chrome-extension/background/**` 是手写源码，文档应引用它们说明行为。
- `chrome-extension/generated/*.js` 与 `chrome-extension/options/options.{js,css}` 是构建产物，只用于说明 Chrome 实际加载什么，不应作为可编辑源码指导读者。
- 文件重命名、消息协议或构建脚本改变时，应同步更新本索引、代码地图和受影响的专题文档。

# 开发说明

Chrome Manifest V3 双语翻译扩展。安装、服务配置和使用限制见[项目 README](../README.md)。

## 开发与验证

使用 Node.js 24，具体版本见 [`.nvmrc`](../.nvmrc)。

```bash
npm ci --ignore-scripts
npm run build:chrome
npm run check
```

`build:chrome` 更新提交到仓库的生成产物；`check` 检查产物一致性、源码语法并运行契约、单元和集成测试，不调用真实翻译服务。

加载目录为 `chrome-extension/`。更新代码并构建后，在扩展管理页重新加载扩展，再刷新目标网页。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| [`src/content/`](../src/content/) | 网页扫描、翻译调度、DOM 变化监听、译文插入与恢复；入口 `main.js`，一次运行由 `translation-run.js` 管理 |
| [`chrome-extension/background/`](../chrome-extension/background/) | 手写 Service Worker；校验消息、保管 Key、管理任务、缓存、用量和服务请求 |
| [`src/core/`](../src/core/) | 设置、语言判断、文本切分、响应与缓存规则 |
| [`src/provider/`](../src/provider/) | 模型 SDK 适配；专用翻译接口位于后台 `providers/` |
| [`src/popup/`](../src/popup/) / [`src/options/`](../src/options/) | 翻译操作面板、设置与调试界面；设置页使用 Vue |
| [`config/provider-allowlist.json`](../config/provider-allowlist.json) / [`data/models-dev-subset.json`](../data/models-dev-subset.json) | 受支持模型与固定目录；修改后运行 `npm run validate:provider-catalog` 并重新构建 |
| [`test/`](../test/) / [`scripts/`](../scripts/) | 自动测试、构建和静态检查 |

`chrome-extension/generated/`、设置页和 popup 的打包 JS/CSS 由脚本生成，不要手改。

## 翻译流程

1. popup 发起翻译，后台检查设置与权限，再注入内容脚本。
2. 内容脚本扫描候选正文，过滤、切分和去重；每波请求派发前按当前视口重新排序。
3. 先查运行内缓存，再由后台查询持久缓存、调用所选服务并校验结果。
4. 收齐段落全部分片后核对原文并写入译文。DOM 变化触发局部重扫；滚动、窗口尺寸和显隐变化通过 `dom/deferred-content-monitor.js` 恢复初扫暂不可布局的正文。
5. 恢复页面时停止监听、清理本次译文和 loading，并取消后台任务。

## 维护边界

- 扫描和渲染逻辑位于 `src/content/dom/`；站点差异集中在 `src/content/site-profile.js`。
- API Key 只由扩展可信上下文读取；内容脚本通过后台发起请求，译文只按文本写入页面。
- 调试从设置页的“调试记录”进入；正文记录需要额外开启，排查时注意区分扫描、请求和渲染阶段。
- 修复行为问题时，在 `test/unit/` 或 `test/integration/` 添加对应回归；手写源码尽量控制在 300 行内，测试前保留中文业务意图注释。
- 默认使用静态检查和自动测试；浏览器或截图验证遵循 [`AGENTS.md`](../AGENTS.md) 的明确授权要求。

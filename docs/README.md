# 开发说明

Chrome Manifest V3 双语翻译扩展。安装、服务配置和使用限制见[项目 README](../README.md)。

历史排查网址与回归入口见[测试过的网站](tested-websites.md)。

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
| [`src/core/reading-settings.js`](../src/core/reading-settings.js) | 阅读样式、字号与行距、英语声音及语音端点的统一默认值和校验 |
| [`src/content/selection/`](../src/content/selection/) | 划词捕获、隔离浮层、独立请求取消与英语发音交互 |
| [`chrome-extension/background/page-service.js`](../chrome-extension/background/page-service.js) | 显式页面激活、逐框架注入、导航和阅读偏好广播 |
| [`chrome-extension/background/frame-runs.js`](../chrome-extension/background/frame-runs.js) | 按 tab/frame 隔离运行指针，防止 iframe 取代主框架任务 |
| [`chrome-extension/background/selection-service.js`](../chrome-extension/background/selection-service.js) | 划词专用生命周期，复用服务、缓存和用量统计 |
| [`chrome-extension/background/speech-service.js`](../chrome-extension/background/speech-service.js) / [`chrome-extension/speech/`](../chrome-extension/speech/) | 系统英语语音、可信上下文中的 Edge 音频合成与播放、停止和资源释放 |
| [`tools/edge-tts/`](../tools/edge-tts/) | 可选的本机 Edge TTS MP3 服务，独立 Python 环境，不随扩展启动 |
| [`src/provider/`](../src/provider/) | 模型 SDK 适配；专用翻译接口位于后台 `providers/` |
| [`src/popup/`](../src/popup/) / [`src/options/`](../src/options/) | 翻译操作面板、设置与调试界面；设置页使用 Vue |
| [`config/provider-allowlist.json`](../config/provider-allowlist.json) / [`data/models-dev-subset.json`](../data/models-dev-subset.json) | 受支持模型与固定目录；修改后运行 `npm run validate:provider-catalog` 并重新构建 |
| [`test/`](../test/) / [`scripts/`](../scripts/) | 自动测试、构建和静态检查 |

`chrome-extension/generated/`、设置页和 popup 的打包 JS/CSS 由脚本生成，不要手改。

## 翻译流程

1. popup、快捷键或右键菜单显式激活页面；后台检查权限，逐个注入可访问的框架。内容脚本安装与开始翻译分别执行，重复注入不会意外切换页面状态。
2. 内容脚本扫描候选正文，过滤、切分和去重；每波请求派发前按当前视口重新排序。
3. 先查运行内缓存，再由后台查询持久缓存、调用所选服务并校验结果。
4. 收齐段落全部分片后核对原文并写入译文。DOM 变化触发局部重扫；滚动、窗口尺寸和显隐变化通过 `dom/deferred-content-monitor.js` 恢复初扫暂不可布局的正文。
5. `dom/page-roots.js` 发现开放 ShadowRoot，共用一份译文样式，并处理延迟升级的 Web Component 与 body 替换。每个 iframe 的后台指针独立。
6. 恢复页面时停止监听、清理本次译文、布局标记和 loading，并取消后台任务；划词可以继续单独使用。

划词与整页任务互相独立，不覆盖整页进度。`background/translation-scheduler.js` 让同一标签页的全部框架共用云端并发预算，划词优先进入下一次空闲请求。语音只通过页面提交文本，端点和访问令牌保留在后台与 offscreen 扩展页面中。新播放替换旧播放，关闭浮层、导航或关闭标签页会释放对应请求和音频。

## 维护边界

- 扫描和渲染逻辑位于 `src/content/dom/`；站点差异集中在 `src/content/site-profile.js`。
- API Key 只由扩展可信上下文读取；内容脚本通过后台发起请求，译文只按文本写入页面。
- 调试从设置页的“调试记录”进入；正文记录需要额外开启，排查时注意区分扫描、请求和渲染阶段。
- 修复行为问题时，在 `test/unit/` 或 `test/integration/` 添加对应回归；手写源码尽量控制在 300 行内，测试前保留中文业务意图注释。
- 默认使用静态检查和自动测试；浏览器或截图验证遵循 [`AGENTS.md`](../AGENTS.md) 的明确授权要求。

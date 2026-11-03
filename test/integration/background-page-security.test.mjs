import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import { createPageService } from "../../chrome-extension/background/page-service.js";
import {
	backgroundCore, backgroundCatalog, createChromeHarness, createConfiguredSettings,
	createProviderRuntimeFake, createWebpageSender, sendAppMessage,
} from "../helpers/background-harness.mjs";

function createApp(options = {}) {
	const harness = createChromeHarness(options);
	const provider = createProviderRuntimeFake();
	const app = createBackgroundApp({
		chrome: harness.chrome, core: backgroundCore, providerCatalog: backgroundCatalog, providerRuntime: provider,
	});
	return { harness, provider, app };
}

const requests = [
	{ type: "START_RUN", runId: "security-run" },
	{ type: "TRANSLATE_BATCH", runId: "security-run", sourceLanguage: "en", targetLanguage: "zh",
		segments: [{ id: "text", text: "Synthetic private project content." }] },
	{ type: "TRANSLATE_SELECTION", requestId: "security-selection", text: "Synthetic private project selection." },
	{ type: "SPEAK_TEXT", requestId: "security-speech", text: "Synthetic private project speech." },
	{ type: "CONTENT_TRACE", runId: "security-run", trace: {} },
];

// 文件来源即使伪装成持久化的已授权页面，也不能到达翻译、朗读或正文调试入口。
test("后台独立拒绝本地来源且不调用服务", async () => {
	for (const url of ["file:///audit/project.txt", "http://localhost:3000/", "https://127.0.0.1/", "https://app.local/"]) {
		const { app, harness, provider } = createApp({ activeTabs: [{ id: 7, url }] });
		await app.start();
		assert.equal((await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" })).status, "unavailable");
		assert.equal((await sendAppMessage(app, { type: "TOGGLE_SELECTION" })).ok, false);
		for (const request of requests) {
			const result = await sendAppMessage(app, request, createWebpageSender({ url }));
			assert.equal(result.ok, false, `${request.type} 必须拒绝本地内容`);
			assert.match(result.error, /本地/u);
		}
		assert.equal(provider.requests.length, 0);
		assert.equal(harness.scriptExecutions.length, 0);
	}
});

// 来源缺失、不透明源、非活动文档和查询失败都不能降级成允许读取。
test("无法验证浏览器身份时拒绝服务请求", async () => {
	const { app, harness, provider } = createApp();
	await app.start();
	for (const override of [{ id: "another-extension" }, { origin: "null" }, { documentId: undefined },
		{ documentLifecycle: "cached" }, { origin: "https://other.example" }]) {
		const sender = { ...createWebpageSender(), ...override };
		assert.equal((await sendAppMessage(app, requests[0], sender)).ok, false);
	}
	harness.chrome.webNavigation.getAllFrames = async () => { throw new Error("Synthetic browser query failure"); };
	assert.equal((await sendAppMessage(app, requests[0], createWebpageSender())).ok, false);
	assert.equal(provider.requests.length, 0);
});

// 授权前后台拒绝正文请求，真实 Popup 操作后只允许相同文档，关闭翻译后立即撤销整页能力。
test("普通网页必须主动启用且不能借用其他文档的授权", async () => {
	const { app, harness, provider } = createApp({ pageAuthorized: false });
	await app.start();
	const sender = createWebpageSender();
	for (const request of requests) {
		assert.equal((await sendAppMessage(app, request, sender)).ok, false);
	}
	assert.equal(provider.requests.length, 0);
	assert.equal((await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" })).status, "triggered");
	assert.equal((await sendAppMessage(app, requests[0], sender)).ok, true);
	assert.equal((await sendAppMessage(app, requests[1], sender)).ok, true);
	assert.equal(provider.requests.length, 1);
	const stranger = createWebpageSender({ documentId: "another-document" });
	assert.equal((await sendAppMessage(app, requests[0], stranger)).ok, false);
	assert.equal((await sendAppMessage(app, requests[0], createWebpageSender({ tabId: 8 }))).ok, false);
	assert.equal((await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" })).status, "triggered");
	assert.equal((await sendAppMessage(app, requests[1], sender)).ok, false);
	assert.equal(provider.requests.length, 1);
	const injected = harness.scriptExecutions.filter(({ details }) => details.files);
	assert.equal(injected.every(({ details }) => details.target.documentIds[0] === sender.documentId), true);
	await sendAppMessage(app, { type: "CANCEL_RUN", runId: "security-run" }, sender);
});

// 旧页面导航和新同源文档都不能抢在导航清理事件之前沿用旧的读取授权。
test("导航后文档身份立即失效，Worker 重启不会恢复旧授权", async () => {
	const first = createApp();
	await first.app.start();
	first.harness.frames[0].documentId = "new-document";
	for (const documentId of ["document-7-0", "new-document"]) {
		const sender = createWebpageSender({ documentId });
		assert.equal((await sendAppMessage(first.app, requests[0], sender)).ok, false);
	}
	const second = createApp({ session: first.harness.session, frames: first.harness.frames });
	await second.app.start();
	assert.equal((await sendAppMessage(second.app, requests[0], createWebpageSender({ documentId: "new-document" }))).ok, false);
	assert.equal(second.provider.requests.length, 0);
});

// 只注入当前页同源的明确文档，已有全站或服务端点权限不能放行跨站及本地 iframe。
test("框架注入和后台来源校验同时拒绝跨站与本地框架", async () => {
	const frames = [
		{ tabId: 7, frameId: 0, documentId: "document-7-0", url: "https://page.example/article" },
		{ tabId: 7, frameId: 1, documentId: "document-7-1", url: "https://page.example/embed" },
		{ tabId: 7, frameId: 2, documentId: "document-7-2", url: "https://127.0.0.1/private" },
		{ tabId: 7, frameId: 3, documentId: "document-7-3", url: "https://other.example/embed" },
	].map((frame) => ({ ...frame, documentLifecycle: "active" }));
	const { app, harness, provider } = createApp({ frames, pageAuthorized: false });
	await app.start();
	await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" });
	const injected = new Set(harness.scriptExecutions.flatMap(({ details }) => details.target.documentIds));
	assert.deepEqual([...injected].sort(), ["document-7-0", "document-7-1"]);
	const ownFrame = createWebpageSender({ frameId: 1, url: frames[1].url, tabUrl: frames[0].url });
	assert.equal((await sendAppMessage(app, requests[0], ownFrame)).ok, true);
	for (const frame of frames.slice(2)) {
		const sender = createWebpageSender({ frameId: frame.frameId, url: frame.url, tabUrl: frames[0].url });
		assert.equal((await sendAppMessage(app, requests[0], sender)).ok, false);
	}
	assert.equal(provider.requests.length, 0);
	await sendAppMessage(app, { type: "CANCEL_RUN", runId: "security-run" }, ownFrame);
});

// 正文注入失败时撤销本次授权，不能因为一次失败的点击留下可调用服务的通道。
test("注入失败会撤销新建的页面授权", async () => {
	const { app, harness } = createApp({ pageAuthorized: false });
	await app.start();
	harness.chrome.scripting.executeScript = async () => { throw new Error("Synthetic injection failure"); };
	assert.equal((await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" })).status, "error");
	assert.equal(harness.session.data["reading-page:7"], undefined);
	assert.equal((await sendAppMessage(app, requests[0], createWebpageSender())).ok, false);
});

// 升级时只移除宽泛授权，保留单独批准的自定义 API；撤销失败必须阻止服务启动。
test("启动撤回旧版全站权限，失败时拒绝继续工作", async () => {
	const { app, harness } = createApp({ grantedOrigins: ["https://*/*", "http://*/*", "https://custom.example/*"] });
	await app.start();
	assert.deepEqual(harness.removedOrigins, ["https://*/*", "http://*/*"]);
	assert.deepEqual(harness.grantedOrigins, ["https://custom.example/*"]);
	const failed = createApp({ grantedOrigins: ["https://*/*"], removePermissionFails: true });
	await assert.rejects(failed.app.start(), /撤回/u);
	assert.equal((await sendAppMessage(failed.app, requests[0], createWebpageSender())).ok, false);
	assert.equal(failed.provider.requests.length, 0);
});

// 迟到的框架完成事件只能补充同源文档，不能把新跨站页面或更换后的主文档加入授权。
test("动态框架仍受主文档和来源边界约束", async () => {
	const harness = createChromeHarness();
	const settings = createConfiguredSettings();
	const page = createPageService({ chrome: harness.chrome, core: backgroundCore,
		settingsStore: { getSettings: async () => settings }, onNavigation: async () => {} });
	for (const [index, url] of ["https://other.example/", "http://localhost:3000/", "https://page.example/embed"].entries()) {
		const frame = { tabId: 7, frameId: index + 1, documentId: `dynamic-${index}`, url, documentLifecycle: "active" };
		harness.frames.push(frame);
		await page.handleFrameReady(frame);
	}
	assert.equal(harness.scriptExecutions.every(({ details }) => details.target.documentIds[0] === "dynamic-2"), true);
	assert.equal(harness.scriptExecutions.length, 3);
	await page.handleNavigation({ tabId: 7, frameId: 3 });
	assert.equal(harness.session.data["reading-page:7"].documents.some((frame) => frame.frameId === 3), false);
	await page.handleNavigation({ tabId: 7, frameId: 0 });
	assert.equal(harness.session.data["reading-page:7"], undefined);
});

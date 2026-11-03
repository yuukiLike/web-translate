import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundApp } from "../../chrome-extension/background/app.js";
import {
	backgroundCore, backgroundCatalog, createChromeHarness, createConfiguredSettings,
	createProviderRuntimeFake, createWebpageSender, sendAppMessage,
} from "../helpers/background-harness.mjs";

async function createApp(settings = createConfiguredSettings()) {
	const harness = createChromeHarness({ settings, pageAuthorized: false });
	const provider = createProviderRuntimeFake();
	const app = createBackgroundApp({
		chrome: harness.chrome, core: backgroundCore, providerCatalog: backgroundCatalog, providerRuntime: provider,
	});
	await app.start();
	assert.equal((await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" })).status, "triggered");
	return { harness, provider, app, sender: createWebpageSender() };
}

function batch(id) {
	return { type: "TRANSLATE_BATCH", runId: "permission-race", sourceLanguage: "en", targetLanguage: "zh",
		segments: [{ id, text: `Synthetic private text ${id}.` }] };
}

for (const selection of [false, true]) {
	// 读取缓存期间关闭对应开关，不能依赖页面主动发送取消消息才停止上传。
	test(`${selection ? "划词" : "整页"}在缓存等待期间关闭后不再上传`, async () => {
		const { app, harness, provider, sender } = await createApp();
		if (!selection) await sendAppMessage(app, { type: "START_RUN", runId: "permission-race" }, sender);
		const entered = Promise.withResolvers();
		const release = Promise.withResolvers();
		const originalGet = harness.local.get.bind(harness.local);
		harness.local.get = async (keys) => {
			if (Array.isArray(keys) && keys.some((key) => key.startsWith(backgroundCore.CACHE_PREFIX))) {
				entered.resolve();
				await release.promise;
			}
			return originalGet(keys);
		};
		const request = selection
			? { type: "TRANSLATE_SELECTION", requestId: "selection-race", text: "Synthetic private text." }
			: batch("cache-wait");
		const pending = sendAppMessage(app, request, sender);
		try {
			await entered.promise;
			const type = selection ? "TOGGLE_SELECTION" : "TOGGLE_ACTIVE_TAB";
			assert.equal((await sendAppMessage(app, { type })).status, "triggered");
		} finally {
			release.resolve();
		}
		assert.equal((await pending).ok, false);
		assert.equal(provider.requests.length, 0);
		// 关闭并清理任务后，用户仍可重新主动启用。
		if (!selection) {
			await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" });
			assert.equal((await sendAppMessage(app, { type: "START_RUN", runId: "re-enabled" }, sender)).ok, true);
			await sendAppMessage(app, { type: "CANCEL_RUN", runId: "re-enabled" }, sender);
		}
	});
}

// 浏览器身份查询等待期间撤销授权，迟到的查询结果也不能恢复旧的权限快照。
test("等待浏览器查询时撤销授权会拒绝请求", async () => {
	const { app, harness, provider, sender } = await createApp();
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	const getFrames = harness.chrome.webNavigation.getAllFrames;
	harness.chrome.webNavigation.getAllFrames = async (details) => {
		const result = await getFrames(details);
		entered.resolve();
		await release.promise;
		return result;
	};
	const pending = sendAppMessage(app, { type: "START_RUN", runId: "permission-race" }, sender);
	try {
		await entered.promise;
		await harness.session.remove("reading-page:7");
	} finally {
		release.resolve();
	}
	assert.equal((await pending).ok, false);
	assert.equal(provider.requests.length, 0);
});

// 排队期间权限独立失效，即使没有收到内容脚本的取消消息，也只能完成此前已发送的请求。
test("已经排队的正文在实际发送前重新检查授权", async () => {
	const { app, harness, provider, sender } = await createApp(createConfiguredSettings({ concurrency: 1 }));
	await sendAppMessage(app, { type: "START_RUN", runId: "permission-race" }, sender);
	const firstEntered = Promise.withResolvers();
	const releaseFirst = Promise.withResolvers();
	const generate = provider.generateTranslation.bind(provider);
	provider.generateTranslation = async (request) => {
		const result = await generate(request);
		firstEntered.resolve();
		await releaseFirst.promise;
		return result;
	};
	const first = sendAppMessage(app, batch("first"), sender);
	await firstEntered.promise;
	const cacheRead = Promise.withResolvers();
	const originalGet = harness.local.get.bind(harness.local);
	harness.local.get = async (keys) => {
		if (Array.isArray(keys) && keys.some((key) => key.startsWith(backgroundCore.CACHE_PREFIX))) cacheRead.resolve();
		return originalGet(keys);
	};
	const queued = sendAppMessage(app, batch("queued"), sender);
	try {
		await cacheRead.promise;
		await new Promise(setImmediate);
		assert.equal(provider.requests.length, 1);
		await harness.session.remove("reading-page:7");
	} finally {
		releaseFirst.resolve();
	}
	assert.equal((await first).ok, true);
	assert.equal((await queued).ok, false);
	assert.equal(provider.requests.length, 1);
	await sendAppMessage(app, { type: "CANCEL_RUN", runId: "permission-race" }, sender);
});

// 首次请求返回截断结果时，关闭操作必须阻止后续自动拆分恢复请求继续发送正文。
test("关闭翻译会取消后台请求和自动恢复", async () => {
	const { app, provider, sender } = await createApp();
	await sendAppMessage(app, { type: "START_RUN", runId: "permission-race" }, sender);
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	const generate = provider.generateTranslation.bind(provider);
	let requestSignal;
	provider.generateTranslation = async (request) => {
		requestSignal = request.abortSignal;
		const result = await generate(request);
		entered.resolve();
		await release.promise;
		return { ...result, finishReason: "length" };
	};
	const pending = sendAppMessage(app, batch("in-flight"), sender);
	try {
		await entered.promise;
		await sendAppMessage(app, { type: "TOGGLE_ACTIVE_TAB" });
		assert.equal(requestSignal.aborted, true);
	} finally {
		release.resolve();
	}
	assert.equal((await pending).ok, false);
	assert.equal(provider.requests.length, 1);
});

for (const engine of ["system", "edge"]) {
	// 语音引擎准备完成前撤销页面授权，系统声音和联网 Edge 都不能收到选中文字。
	test(`${engine} 朗读准备期间撤销权限不会播放或上传`, async () => {
		const { app, harness, sender } = await createApp(createConfiguredSettings({
			speech: { engine, token: "synthetic-token" },
		}));
		const entered = Promise.withResolvers();
		const release = Promise.withResolvers();
		const spoken = [];
		harness.chrome.tts = { stop() {}, speak: async (text) => spoken.push(text),
			getVoices: async () => {
				entered.resolve();
				await release.promise;
				return [{ voiceName: "Local", lang: "en-US", remote: false }];
			},
		};
		harness.chrome.runtime.getContexts = async () => {
			entered.resolve();
			await release.promise;
			return [{}];
		};
		harness.chrome.runtime.sendMessage = async (message) => {
			if (message.type === "PLAY") spoken.push(message.text);
			return { ok: true };
		};
		const pending = sendAppMessage(app, { type: "SPEAK_TEXT", requestId: "speech-race", text: "Synthetic private text." }, sender);
		try {
			await entered.promise;
			await harness.session.remove("reading-page:7");
		} finally {
			release.resolve();
		}
		assert.equal((await pending).ok, false);
		assert.equal(spoken.length, 0);
		assert.equal(harness.session.data["reading-speech"], undefined);
	});
}

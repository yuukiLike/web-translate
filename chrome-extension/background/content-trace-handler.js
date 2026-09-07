import { canCaptureContent } from "./debug-content-policy.js";

export function createContentTraceHandler({ settingsStore, runStore, validators, debug }) {
	return async function recordContentTrace(message, sender) {
		if (!sender.tab?.id || sender.frameId !== 0) {
			throw new Error("内容记录必须来自当前网页主框架");
		}
		const tabId = sender.tab.id;
		const runId = validators.validateRunId(message.runId);
		const snapshot = await runStore.getSnapshot(tabId, runId);
		const settings = await settingsStore.getSettings();
		const incognito = sender.tab.incognito === true;
		if (!canCaptureContent(settings, incognito) || snapshot.settings.provider !== "deepseek") {
			return { captured: false };
		}
		if (await runStore.getCurrentRunId(tabId) !== runId) throw new Error("翻译任务已失效");
		const alias = message.type === "CONTENT_TRACE_ALIAS";
		debug.record({
			component: "content",
			eventType: alias ? "content.alias" : "content.planned",
			tabId,
			runId,
			provider: "deepseek",
			status: "completed",
			requestPayloadAllowed: true,
			incognito: false,
			...(alias ? { contentAliases: message.aliases } : { contentTrace: message.trace }),
		});
		return { captured: true };
	};
}

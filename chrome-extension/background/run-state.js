import { isActiveCurrentRun } from "./run-persistence.js";

export function selectCurrentRunId(currentRun, includeCancelled) {
	return includeCancelled || isActiveCurrentRun(currentRun) ? currentRun.runId : "";
}

export function createCancellationError() {
	return new Error("翻译已取消");
}

export function createInvalidRunError() {
	return new Error("翻译任务已失效，请重新点击扩展图标");
}

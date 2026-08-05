import { TIMING } from "./constants.js";

/** 协调页面提示与扩展图标状态，所有状态消息都携带 runId。 */
export class StatusReporter {
	#completionRequestActive = false;

	constructor({ runId, progress, view, runtime, isCurrent, hasPendingWork }) {
		this.runId = runId;
		this.progress = progress;
		this.view = view;
		this.runtime = runtime;
		this.isCurrent = isCurrent;
		this.hasPendingWork = hasPendingWork;
	}

	async reportProgress() {
		if (!this.isCurrent() || this.progress.completed >= this.progress.total) {
			return;
		}
		this.view.show(`正在翻译，已完成 ${this.progress.completed} 个文本块…`);
		this.progress.statusVisible = true;
		await this.runtime.reportStatus(this.runId, "working", {
			completed: this.progress.completed,
			total: this.progress.total,
		});
	}

	async reportCompletion() {
		const completed = this.progress.completed;
		const total = this.progress.total;
		if (this.progress.isUnchangedSinceLastReport()) {
			return;
		}

		await delay(TIMING.completionSettle);
		if (!this.#isSameSettledSnapshot(completed, total)) {
			return;
		}
		this.#completionRequestActive = true;
		try {
			await this.runtime.reportStatus(this.runId, total === 0 ? "off" : "done");
		} finally {
			this.#completionRequestActive = false;
		}
		if (!this.#isSameSettledSnapshot(completed, total)) {
			return;
		}

		this.progress.markReported();
		if (total === 0) {
			this.view.show("未找到需要翻译的正文", {
				label: "打开设置",
				onClick: () => void this.runtime.openOptions(),
			});
			return;
		}
		this.view.show(`双语翻译完成，已覆盖 ${completed} 个文本块`);
		this.view.hideAfterCompletion();
	}

	invalidatePendingCompletion() {
		if (!this.#completionRequestActive || !this.isCurrent()) {
			return false;
		}
		void this.runtime.reportStatus(this.runId, "settling").catch(() => {});
		return true;
	}

	handleError(error) {
		if (!this.isCurrent() || error?.name === "AbortError" || error?.message === "翻译已取消") {
			return;
		}
		const message =
			typeof error?.message === "string" && error.message ? error.message : "未知翻译错误";
		this.view.show(message, {
			label: error?.requiresSettings ? "选择云服务" : "打开设置",
			onClick: () => void this.runtime.openOptions(),
		});
		this.progress.statusVisible = false;
		void this.runtime.reportStatus(this.runId, "error", { error: message });
	}

	#isSameSettledSnapshot(completed, total) {
		return (
			this.isCurrent() &&
			!this.hasPendingWork() &&
			this.progress.completed === completed &&
			this.progress.total === total
		);
	}
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

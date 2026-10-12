import { TIMING } from "./constants.js";

/** 协调页面提示与扩展图标状态，所有状态消息都携带 runId。 */
export class StatusReporter {
	#completionRequestActive = false;
	#lastReportedDeferred = false;

	constructor({ runId, progress, view, runtime, isCurrent, hasPendingWork, hasDeferredContent = () => false, onRetry }) {
		this.runId = runId;
		this.progress = progress;
		this.view = view;
		this.runtime = runtime;
		this.isCurrent = isCurrent;
		this.hasPendingWork = hasPendingWork;
		this.hasDeferredContent = hasDeferredContent;
		this.onRetry = onRetry;
	}

	async reportProgress() {
		if (!this.isCurrent() || this.progress.completed >= this.progress.total) {
			return;
		}
		this.view.show(`正在翻译 ${this.progress.completed} / ${this.progress.total} 个文本块…`, null, "working");
		this.progress.statusVisible = true;
		await this.runtime.reportStatus(this.runId, "working", {
			completed: this.progress.completed,
			total: this.progress.total,
		});
	}

	async reportCompletion() {
		const completed = this.progress.completed;
		const total = this.progress.total;
		const deferred = this.hasDeferredContent();
		if (this.progress.isUnchangedSinceLastReport() && deferred === this.#lastReportedDeferred) {
			return;
		}

		await delay(TIMING.completionSettle);
		if (!this.#isSameSettledSnapshot(completed, total, deferred)) {
			return;
		}
		this.#completionRequestActive = true;
		try {
			await this.runtime.reportStatus(this.runId, total === 0 && !deferred ? "off" : "done", { deferred });
		} finally {
			this.#completionRequestActive = false;
		}
		if (!this.#isSameSettledSnapshot(completed, total, deferred)) {
			return;
		}

		this.progress.markReported();
		this.#lastReportedDeferred = deferred;
		if (total === 0 && !deferred) {
			this.view.show("当前页面没有需要翻译的外语正文", {
				label: "调整语言设置",
				onClick: () => void this.runtime.openOptions(),
			});
			return;
		}
		const message = total === 0
			? "滚动到正文后继续翻译"
			: `已覆盖 ${completed} 个文本块${deferred ? "，滚动后继续" : ""}`;
		this.view.show(message, null, "done");
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
			label: error?.requiresSettings || !this.onRetry ? "打开设置" : "重试",
			onClick: () => {
				if (error?.requiresSettings || !this.onRetry) void this.runtime.openOptions().catch(() => {});
				else void this.onRetry().catch((retryError) => this.handleError(retryError));
			},
		}, "error");
		this.progress.statusVisible = false;
		void this.runtime.reportStatus(this.runId, "error", { error: message }).catch(() => {});
	}

	#isSameSettledSnapshot(completed, total, deferred) {
		return (
			this.isCurrent() &&
			!this.hasPendingWork() &&
			this.progress.completed === completed &&
			this.progress.total === total &&
			this.hasDeferredContent() === deferred
		);
	}
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

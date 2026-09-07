import { TIMING } from "../constants.js";

/** 恢复已发现但暂不可布局的正文；滚动只检查待恢复集合，不重扫整页。 */
export class DeferredContentMonitor {
	#timer = null;

	constructor({ elementStore, layout, rootQueue, isCurrent, onScan, onActivity, onError }) {
		this.elementStore = elementStore;
		this.layout = layout;
		this.rootQueue = rootQueue;
		this.isCurrent = isCurrent;
		this.onScan = onScan;
		this.onActivity = onActivity;
		this.onError = onError;
	}

	start() {
		// scroll 不冒泡，捕获阶段同时覆盖窗口与内部滚动容器。
		window.addEventListener("scroll", this.#schedule, { capture: true, passive: true });
		window.addEventListener("resize", this.#schedule);
	}

	stop() {
		window.removeEventListener("scroll", this.#schedule, true);
		window.removeEventListener("resize", this.#schedule);
		clearTimeout(this.#timer);
		this.#timer = null;
	}

	hasRestoredElement(target) {
		for (const element of this.elementStore.deferredElements) {
			if (isRelated(target, element) && this.layout.isEligible(element)) {
				return true;
			}
		}
		return false;
	}

	restore(targets = []) {
		let restored = false;
		for (const element of this.elementStore.deferredElements) {
			if (!element.isConnected) {
				this.elementStore.deferredElements.delete(element);
				continue;
			}
			if (targets.length > 0 && !targets.some((target) => isRelated(target, element))) {
				continue;
			}
			if (!this.layout.isEligible(element)) {
				continue;
			}
			this.elementStore.deferredElements.delete(element);
			this.rootQueue.add(element);
			restored = true;
		}
		return restored;
	}

	#schedule = () => {
		if (!this.isCurrent() || this.#timer !== null || this.elementStore.deferredElements.size === 0) {
			return;
		}
		// 固定时间处理一次，持续滚动不能反复重置等待窗口。
		this.#timer = setTimeout(() => {
			this.#timer = null;
			this.#restoreAndScan();
		}, TIMING.visibilityDebounce);
		// 已可布局的正文立即入队，不能在等待后续布局时先报告完成。
		this.#restoreAndScan();
	};

	#restoreAndScan() {
		if (!this.isCurrent() || !this.restore()) {
			return;
		}
		this.onActivity();
		void this.onScan().catch(this.onError);
	}
}

function isRelated(target, element) {
	return target === element || target.contains(element) || element.contains(target);
}

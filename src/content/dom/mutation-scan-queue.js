import { TIMING } from "../constants.js";
import { RootQueue } from "../root-queue.js";

/**
 * 暂存 DOM mutation 产生的扫描根，安静窗口结束后才发布给翻译流水线。
 * 这样在途云请求无法绕过 mutation debounce 消费动画中间帧。
 */
export class MutationScanQueue {
	#pendingRoots = new RootQueue();
	#timer = null;

	constructor({ isCurrent, rootQueue, beforeFlush, onScan, onError }) {
		this.isCurrent = isCurrent;
		this.rootQueue = rootQueue;
		this.beforeFlush = beforeFlush;
		this.onScan = onScan;
		this.onError = onError;
	}

	get hasPendingWork() {
		return this.#timer !== null || this.#pendingRoots.size > 0;
	}

	add(root) {
		this.#pendingRoots.add(root);
	}

	schedule() {
		if (!this.isCurrent()) {
			return;
		}
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
		}
		this.#timer = setTimeout(() => this.#flush(), TIMING.mutationDebounce);
	}

	stop() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		this.#pendingRoots.clear();
	}

	#flush() {
		this.#timer = null;
		if (!this.isCurrent()) {
			this.#pendingRoots.clear();
			return;
		}
		this.beforeFlush();
		for (const root of this.#pendingRoots.take()) {
			this.rootQueue.add(root);
		}
		void this.onScan().catch(this.onError);
	}
}

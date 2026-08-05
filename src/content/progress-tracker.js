/**
 * 进度按“元素 + 翻译方向 + 原文哈希”去重。
 * completed 只增不减，因此虚拟列表移除节点时不会出现 144 -> 99 的回退。
 */
export class ProgressTracker {
	#countedRecords = new WeakMap();
	#completedRecords = new WeakMap();

	completed = 0;
	total = 0;
	lastReportedCompleted = -1;
	lastReportedTotal = -1;
	statusVisible = false;

	count(element, progressKey) {
		if (addProgressKey(this.#countedRecords, element, progressKey)) {
			this.total += 1;
		}
	}

	complete(element, progressKey) {
		if (addProgressKey(this.#completedRecords, element, progressKey)) {
			this.completed += 1;
		}
	}

	cancelPending(element, progressKey) {
		if (
			progressKey &&
			!hasProgressKey(this.#completedRecords, element, progressKey) &&
			removeProgressKey(this.#countedRecords, element, progressKey)
		) {
			this.total = Math.max(this.completed, this.total - 1);
		}
	}

	isUnchangedSinceLastReport() {
		return (
			!this.statusVisible &&
			this.completed === this.lastReportedCompleted &&
			this.total === this.lastReportedTotal
		);
	}

	markReported() {
		this.lastReportedCompleted = this.completed;
		this.lastReportedTotal = this.total;
		this.statusVisible = false;
	}
}

function addProgressKey(progressByElement, element, progressKey) {
	let keys = progressByElement.get(element);
	if (!keys) {
		keys = new Set();
		progressByElement.set(element, keys);
	}
	if (keys.has(progressKey)) {
		return false;
	}
	keys.add(progressKey);
	return true;
}

function hasProgressKey(progressByElement, element, progressKey) {
	return progressByElement.get(element)?.has(progressKey) === true;
}

function removeProgressKey(progressByElement, element, progressKey) {
	const keys = progressByElement.get(element);
	if (!keys?.delete(progressKey)) {
		return false;
	}
	if (keys.size === 0) {
		progressByElement.delete(element);
	}
	return true;
}

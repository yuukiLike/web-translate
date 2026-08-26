/**
 * 进度按“元素 + 翻译方向 + 原文哈希”去重。
 * 常规取消保持已完成进度单调；只有明确丢弃整个元素时才撤销其记录。
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

	discard(element) {
		const counted = removeElementRecords(this.#countedRecords, element);
		const completed = removeElementRecords(this.#completedRecords, element);
		this.total = Math.max(0, this.total - counted);
		this.completed = Math.max(0, this.completed - completed);
	}

	transfer(source, target) {
		if (!source || !target || source === target) {
			return;
		}
		this.total = Math.max(
			0,
			this.total - transferElementRecords(this.#countedRecords, source, target),
		);
		this.completed = Math.max(
			0,
			this.completed - transferElementRecords(this.#completedRecords, source, target),
		);
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

function removeElementRecords(progressByElement, element) {
	const keys = progressByElement.get(element);
	if (!keys) {
		return 0;
	}
	progressByElement.delete(element);
	return keys.size;
}

function transferElementRecords(progressByElement, source, target) {
	const sourceKeys = progressByElement.get(source);
	if (!sourceKeys) {
		return 0;
	}
	const targetKeys = progressByElement.get(target) ?? new Set();
	let duplicates = 0;
	for (const key of sourceKeys) {
		if (targetKeys.has(key)) {
			duplicates += 1;
		} else {
			targetKeys.add(key);
		}
	}
	progressByElement.set(target, targetKeys);
	progressByElement.delete(source);
	return duplicates;
}

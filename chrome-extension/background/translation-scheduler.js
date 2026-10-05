/** 一个标签页的所有框架共用并发预算；划词优先于排队中的整页任务。 */
export function createTranslationScheduler() {
	const lanes = new Map();

	function run(tabId, limit, operation, signal, priority = 1) {
		if (signal.aborted) return Promise.reject(signal.reason);
		const lane = lanes.get(tabId) ?? { running: 0, queue: [], limit };
		lane.limit = Math.min(lane.limit, limit);
		lanes.set(tabId, lane);
		return new Promise((resolve, reject) => {
			const item = { operation, signal, resolve, reject, priority, cancel: null };
			item.cancel = () => {
				const index = lane.queue.indexOf(item);
				if (index < 0) return;
				lane.queue.splice(index, 1);
				reject(signal.reason);
				drain(tabId, lane);
			};
			signal.addEventListener("abort", item.cancel, { once: true });
			lane.queue.push(item);
			drain(tabId, lane);
		});
	}

	function drain(tabId, lane) {
		while (lane.running < lane.limit && lane.queue.length) {
			const index = lane.queue.findIndex((item) => item.priority === 0);
			const [item] = lane.queue.splice(index < 0 ? 0 : index, 1);
			item.signal.removeEventListener("abort", item.cancel);
			if (item.signal.aborted) {
				item.reject(item.signal.reason);
				continue;
			}
			lane.running += 1;
			void Promise.resolve().then(() => {
				item.signal.throwIfAborted();
				return item.operation();
			}).then(item.resolve, item.reject).finally(() => {
				lane.running -= 1;
				drain(tabId, lane);
			});
		}
		if (!lane.running && !lane.queue.length) lanes.delete(tabId);
	}

	return { run };
}

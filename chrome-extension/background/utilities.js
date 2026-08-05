export function numberOrZero(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function numberOrUndefined(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function createIdentifier() {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function estimateStorageBytes(value) {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function sumSegmentCharacters(segments) {
	return segments.reduce((sum, segment) => sum + segment.text.length, 0);
}

export function getErrorMessage(error) {
	return error instanceof Error && error.message ? error.message : "未知错误";
}

export function runKey(tabId, runId) {
	return `${tabId}:${runId}`;
}

export function createSerialTaskQueue() {
	let tail = Promise.resolve();

	function run(operation) {
		const task = tail.then(operation);
		tail = task.catch(() => {});
		return task;
	}

	async function wait() {
		await tail;
	}

	return { run, wait };
}

export function createKeyedSerialTaskQueue() {
	const tails = new Map();

	function run(key, operation) {
		const previous = tails.get(key) ?? Promise.resolve();
		const task = previous.catch(() => {}).then(operation);
		tails.set(key, task);
		const cleanup = () => {
			if (tails.get(key) === task) {
				tails.delete(key);
			}
		};
		void task.then(cleanup, cleanup);
		return task;
	}

	return { run };
}

import { getSegmentKey } from "./run-cache.js";
import { takeNextCloudBatch } from "./batching.js";

/** 管理并发云请求，同时吸收翻译期间新出现的 DOM 文本。 */
export class CloudTranslator {
	constructor({
		core,
		settings,
		runId,
		runtime,
		rootQueue,
		planner,
		runCache,
		renderer,
		elementStore,
		invalidator,
		isCurrent,
		reportProgress,
	}) {
		this.core = core;
		this.settings = settings;
		this.runId = runId;
		this.runtime = runtime;
		this.rootQueue = rootQueue;
		this.planner = planner;
		this.runCache = runCache;
		this.renderer = renderer;
		this.elementStore = elementStore;
		this.invalidator = invalidator;
		this.isCurrent = isCurrent;
		this.reportProgress = reportProgress;
	}

	resolveFromRunCache(segments) {
		const unresolved = [];
		for (const segment of segments) {
			if (this.runCache.has(segment)) {
				this.#applyTranslation(segment, this.runCache.get(segment));
			} else {
				unresolved.push(segment);
			}
		}
		return unresolved;
	}

	async translate(segments) {
		const limits = this.core.getProviderLimits(this.settings.provider);
		const concurrency = Math.min(
			this.core.getProviderMaximumConcurrency(this.settings.provider),
			this.settings.concurrency,
		);
		const queue = [...segments];

		while (this.isCurrent() && (queue.length > 0 || this.rootQueue.size > 0)) {
			if (this.rootQueue.size > 0) {
				this.#enqueueSegments(queue, this.planner.collectSegments(this.rootQueue.take()));
			}
			this.#discardStaleTargets(queue);
			if (queue.length === 0) {
				continue;
			}

			const wave = [];
			for (let index = 0; index < concurrency && queue.length > 0; index += 1) {
				const batch = takeNextCloudBatch(queue, limits, this.core);
				wave.push({ batch, request: this.#translateBatch(batch) });
			}
			const outcomes = await Promise.allSettled(wave.map((item) => item.request));
			let failed = null;
			for (const [index, outcome] of outcomes.entries()) {
				if (outcome.status === "rejected") {
					this.#resetFailedBatch(wave[index].batch);
					failed ??= outcome;
				}
			}
			if (failed) {
				throw failed.reason;
			}
			await this.reportProgress();
		}
	}

	#discardStaleTargets(queue) {
		for (let index = queue.length - 1; index >= 0; index -= 1) {
			const segment = queue[index];
			segment.targets = segment.targets.filter(({ record }) => {
				const state = this.elementStore.getState(record.element);
				return (
					record.element.isConnected &&
					state?.revision === record.revision &&
					state.originalHash === record.originalHash
				);
			});
			if (segment.targets.length === 0) {
				queue.splice(index, 1);
			}
		}
	}

	#enqueueSegments(queue, segments) {
		for (const segment of segments) {
			if (this.runCache.has(segment)) {
				this.#applyTranslation(segment, this.runCache.get(segment));
				continue;
			}
			const key = getSegmentKey(segment);
			const queued = queue.find((item) => getSegmentKey(item) === key);
			if (queued) {
				queued.priority = Math.min(queued.priority, segment.priority);
				queued.targets.push(...segment.targets);
			} else {
				queue.push(segment);
			}
		}
	}

	async #translateBatch(batch) {
		const response = await this.runtime.translateBatch(this.runId, batch);
		if (!this.isCurrent()) {
			return;
		}
		for (const result of response.results) {
			const segment = batch.items.find((item) => item.id === result.id);
			if (!segment || typeof result.text !== "string") {
				throw new Error("翻译服务返回了未知段落");
			}
			this.runCache.set(segment, result.text);
			this.#applyTranslation(segment, result.text);
		}
	}

	#applyTranslation(segment, translation) {
		if (!this.isCurrent()) {
			return;
		}
		for (const target of segment.targets) {
			target.record.translations[target.partIndex] = translation.trim();
			this.renderer.renderIfReady(target.record, this.runId);
		}
	}

	#resetFailedBatch(batch) {
		const records = new Set(
			batch.items.flatMap((segment) => segment.targets.map((target) => target.record)),
		);
		for (const record of records) {
			const elementState = this.elementStore.getState(record.element);
			if (elementState?.revision !== record.revision) {
				continue;
			}
			this.invalidator.invalidate(record.element);
			this.rootQueue.add(record.element);
		}
	}
}

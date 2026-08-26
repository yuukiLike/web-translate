export const CONTENT_VOLATILITY = Object.freeze({
	changeLimit: 3,
	windowMs: 15_000,
});

/** 在单次翻译运行内识别短时间反复变化的内容，但只排除实际变化的内容单元。 */
export class ContentVolatilityTracker {
	#changeTimesByActivity = new WeakMap();
	#volatileActivities = new WeakSet();
	#excludedContentRoots = new WeakSet();

	constructor({
		clock = Date.now,
		changeLimit = CONTENT_VOLATILITY.changeLimit,
		windowMs = CONTENT_VOLATILITY.windowMs,
	} = {}) {
		this.clock = clock;
		this.changeLimit = changeLimit;
		this.windowMs = windowMs;
	}

	reset() {
		this.#changeTimesByActivity = new WeakMap();
		this.#volatileActivities = new WeakSet();
		this.#excludedContentRoots = new WeakSet();
	}

	recordChange(activityIdentity, affectedElements = []) {
		const uniqueAffectedElements = [...new Set(affectedElements)].filter(Boolean);
		if (this.isActivityVolatile(activityIdentity)) {
			return {
				becameVolatile: false,
				affectedElements: this.excludeForVolatileActivity(
					activityIdentity,
					uniqueAffectedElements,
				),
			};
		}

		const changedAt = this.clock();
		const recentChangeTimes = this.#getRecentChangeTimes(activityIdentity, changedAt);
		recentChangeTimes.push(changedAt);

		if (recentChangeTimes.length < this.changeLimit) {
			this.#changeTimesByActivity.set(activityIdentity, recentChangeTimes);
			return {
				becameVolatile: false,
				affectedElements: uniqueAffectedElements,
			};
		}

		this.#changeTimesByActivity.delete(activityIdentity);
		this.#volatileActivities.add(activityIdentity);
		this.#excludeContentRoots(uniqueAffectedElements);
		return {
			becameVolatile: true,
			affectedElements: uniqueAffectedElements,
		};
	}

	isActivityVolatile(activityIdentity) {
		return Boolean(activityIdentity && this.#volatileActivities.has(activityIdentity));
	}

	excludeForVolatileActivity(activityIdentity, contentRoots) {
		if (!this.isActivityVolatile(activityIdentity)) {
			return [];
		}
		const uniqueRoots = [...new Set(contentRoots)].filter(Boolean);
		this.#excludeContentRoots(uniqueRoots);
		return uniqueRoots;
	}

	isVolatile(element) {
		return Boolean(this.findVolatileContentRoot(element));
	}

	findVolatileContentRoot(element) {
		for (let current = element; current; current = current.parentElement) {
			if (this.#excludedContentRoots.has(current)) {
				return current;
			}
		}
		return null;
	}

	#getRecentChangeTimes(activityIdentity, changedAt) {
		const earliestAllowed = changedAt - this.windowMs;
		return (this.#changeTimesByActivity.get(activityIdentity) ?? []).filter(
			(changeTime) => changeTime >= earliestAllowed,
		);
	}

	#excludeContentRoots(contentRoots) {
		for (const root of contentRoots) {
			this.#excludedContentRoots.add(root);
		}
	}
}

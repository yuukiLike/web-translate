import { createSerialTaskQueue, numberOrZero } from "./utilities.js";

export function createUsageStore({ chrome, core }) {
	const writeQueue = createSerialTaskQueue();

	function record(provider, addition) {
		return writeQueue.run(() => recordNow(provider, addition));
	}

	async function recordNow(provider, addition) {
		const stored = await chrome.storage.local.get(core.USAGE_KEY);
		const allUsage = core.isRecord(stored[core.USAGE_KEY]) ? stored[core.USAGE_KEY] : {};
		const monthKey = core.getMonthKey();
		const month = core.isRecord(allUsage[monthKey]) ? allUsage[monthKey] : {};
		const previous = core.isRecord(month[provider]) ? month[provider] : {};
		month[provider] = {
			apiCalls: sum(previous, addition, "apiCalls"),
			charactersSubmitted: sum(previous, addition, "charactersSubmitted"),
			cachedCharacters: sum(previous, addition, "cachedCharacters"),
			billedCharacters: sum(previous, addition, "billedCharacters"),
			inputTokens: sum(previous, addition, "inputTokens"),
			cachedInputTokens: sum(previous, addition, "cachedInputTokens"),
			outputTokens: sum(previous, addition, "outputTokens"),
		};
		allUsage[monthKey] = month;
		const recentMonths = Object.keys(allUsage).sort().slice(-12);
		await chrome.storage.local.set({
			[core.USAGE_KEY]: Object.fromEntries(
				recentMonths.map((key) => [key, allUsage[key]]),
			),
		});
	}

	function sum(previous, addition, field) {
		return numberOrZero(previous[field]) + numberOrZero(addition[field]);
	}

	return { record };
}

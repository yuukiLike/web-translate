import { PRIORITY, VISIBLE_BATCH_LIMIT } from "../constants.js";

/** 按语言方向、可见性和服务商限制取出下一批请求。 */
export function takeNextCloudBatch(queue, limits, core) {
	queue.sort((left, right) => left.priority - right.priority);
	const first = queue[0];
	const visible = first.priority < PRIORITY.belowFold;
	const candidates = queue.filter(
		(segment) =>
			segment.sourceLanguage === first.sourceLanguage &&
			segment.targetLanguage === first.targetLanguage &&
			(segment.priority < PRIORITY.belowFold) === visible,
	);
	const maximumCharacters = visible
		? Math.min(VISIBLE_BATCH_LIMIT.characters, limits.maximumCharacters)
		: limits.maximumCharacters;
	const maximumItems = visible
		? Math.min(VISIBLE_BATCH_LIMIT.items, limits.maximumItems)
		: limits.maximumItems;
	const items = core.batchSegments(candidates, maximumCharacters, maximumItems)[0];
	const selected = new Set(items);

	for (let index = queue.length - 1; index >= 0; index -= 1) {
		if (selected.has(queue[index])) {
			queue.splice(index, 1);
		}
	}
	return {
		items,
		sourceLanguage: first.sourceLanguage,
		targetLanguage: first.targetLanguage,
	};
}

import { sumSegmentCharacters } from "../utilities.js";

export const MAX_RESPONSE_RECOVERY_SPLITS = 2;

export function splitSegmentBatch(segments) {
	const totalCharacters = sumSegmentCharacters(segments);
	let runningCharacters = 0;
	let splitIndex = 1;
	let smallestDifference = Number.POSITIVE_INFINITY;
	for (let index = 1; index < segments.length; index += 1) {
		runningCharacters += segments[index - 1].text.length;
		const difference = Math.abs(totalCharacters / 2 - runningCharacters);
		if (difference < smallestDifference) {
			smallestDifference = difference;
			splitIndex = index;
		}
	}
	return [segments.slice(0, splitIndex), segments.slice(splitIndex)];
}

export function splitSingleSegment(core, segment, splitId) {
	const normalizedText = core.normalizeSourceText(segment.text);
	const maximumCharacters = Math.max(1, Math.ceil(normalizedText.length / 2));
	const [firstPart = ""] = core.splitText(normalizedText, maximumCharacters);
	const secondPart = normalizedText.slice(firstPart.length).trim();
	return [firstPart, secondPart].filter(Boolean).map((text, index) => [
		{ id: `${segment.id}__recovery_${splitId}_${index}`, text },
	]);
}

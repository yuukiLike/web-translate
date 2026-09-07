import { createModelTranslator } from "../../chrome-extension/background/providers/model-translator.js";
import { backgroundCore, createConfiguredSettings } from "./background-harness.mjs";

export function createTranslator(generateTranslation) {
	const debugEvents = [];
	return {
		debugEvents,
		translator: createModelTranslator({
			core: backgroundCore,
			providerRuntime: { generateTranslation },
			debug: {
				getSafeEndpoint: (endpoint) => endpoint,
				recordRequest: (_context, event) => debugEvents.push(structuredClone(event)),
			},
			debugMetadata: { createRequestContext: () => ({}) },
		}),
	};
}

export function successfulResult(request, usage = { inputTokens: 10, outputTokens: 5 }) {
	const payload = JSON.parse(request.messages[0].content);
	return {
		text: JSON.stringify({
			translations: payload.segments.map((segment) => ({
				id: segment.id,
				text: `译文：${segment.text}`,
			})),
		}),
		finishReason: "stop",
		usage,
	};
}

export async function translate(
	translator,
	segments,
	settings = createConfiguredSettings(),
	signal = new AbortController().signal,
) {
	return await translator.translate(settings, "en", "zh", segments, signal);
}

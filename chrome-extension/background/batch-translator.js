import { getSafeErrorCode } from "./request-errors.js";
import { numberOrUndefined, numberOrZero, sumSegmentCharacters } from "./utilities.js";

export function createBatchTranslator({
	core,
	extensionVersion,
	cacheStore,
	usageStore,
	providerService,
	settingsStore,
	debug,
}) {
	async function translate(
		snapshot,
		request,
		tabId,
		usePersistentCache,
		batchState,
		signal,
		privacy = {},
	) {
		assertNotAborted(signal);
		const settings = snapshot.settings;
		settingsStore.assertProviderConfigured(settings);
		const context = {
			settings,
			request,
			tabId,
			incognito: privacy.incognito === true,
			...batchState,
			sourceCharacters: sumSegmentCharacters(request.segments),
		};
		recordBatchReceived(context);

		const cacheResult = await resolveCache(
			context,
			snapshot.cacheScope,
			usePersistentCache,
		);
		assertNotAborted(signal);
		if (cacheResult.missingSegments.length > 0) {
			const translatedBatch = await translateMissing(
				context,
				cacheResult.missingSegments,
				signal,
			);
			assertNotAborted(signal);
			await persistTranslation(
				context,
				snapshot,
				cacheResult.cachedTranslations,
				cacheResult.missingSegments,
				translatedBatch,
				usePersistentCache,
			);
			assertNotAborted(signal);
			for (const entry of translatedBatch.entries) {
				cacheResult.cachedTranslations.set(entry.id, entry.translation);
			}
		} else {
			await usageStore.record(settings.provider, {
				apiCalls: 0,
				charactersSubmitted: 0,
				cachedCharacters: sumSegmentCharacters(request.segments),
			});
			assertNotAborted(signal);
		}

		recordBatchCompleted(
			context,
			cacheResult.cacheHits,
			cacheResult.missingSegments.length,
		);
		return {
			results: request.segments.map((segment) => ({
				id: segment.id,
				text: cacheResult.cachedTranslations.get(segment.id),
			})),
			cacheHits: cacheResult.cacheHits,
		};
	}

	function recordFailure(snapshot, request, tabId, batchState, error) {
		debug.record({
			component: "background",
			eventType: "batch.failed",
			tabId,
			runId: request.runId,
			provider: snapshot.settings.provider,
			model: core.getProviderModel(snapshot.settings),
			sourceLanguage: request.sourceLanguage,
			targetLanguage: request.targetLanguage,
			segmentCount: request.segments.length,
			sourceCharacters: sumSegmentCharacters(request.segments),
			...batchState,
			status: "failed",
			errorCode: getSafeErrorCode(error),
			cancelled: error?.message === "翻译已取消",
		});
	}

	async function resolveCache(context, cacheScope, usePersistentCache) {
		const { settings, request } = context;
		const cachedTranslations = usePersistentCache
			? await cacheStore.lookup(
					settings,
					request.sourceLanguage,
					request.targetLanguage,
					request.segments,
					cacheScope,
				)
			: new Map();
		const missingSegments = request.segments.filter(
			(segment) => !cachedTranslations.has(segment.id),
		);
		const cacheHits = request.segments.length - missingSegments.length;
		debug.record({
			...debugFields(context, "cache", "cache.resolved"),
			extensionVersion,
			cacheHits,
			cacheMisses: missingSegments.length,
			status: "completed",
		});
		return { cachedTranslations, missingSegments, cacheHits };
	}

	async function translateMissing(context, missingSegments, signal) {
		const { settings, request, tabId, batchIndex, queueDepth, incognito } = context;
		const providerResult = await providerService.translate(
			settings,
			request.sourceLanguage,
			request.targetLanguage,
			missingSegments,
			signal,
			{ tabId, runId: request.runId, batchIndex, queueDepth, incognito },
		);
		assertNotAborted(signal);
		if (providerResult.translations.length !== missingSegments.length) {
			throw new Error("翻译服务返回的段落数量不一致");
		}
		debug.record({
			component: "provider",
			eventType: "provider.usage",
			tabId,
			runId: request.runId,
			provider: settings.provider,
			model: core.getProviderModel(settings),
			segmentCount: missingSegments.length,
			sourceCharacters: sumSegmentCharacters(missingSegments),
			batchIndex,
			queueDepth,
			inputTokens: numberOrUndefined(providerResult.usage.inputTokens),
			outputTokens: numberOrUndefined(providerResult.usage.outputTokens),
			cacheReadTokens: numberOrUndefined(providerResult.usage.cachedInputTokens),
			noCacheTokens:
				typeof providerResult.usage.inputTokens === "number"
					? Math.max(
							0,
							providerResult.usage.inputTokens -
								numberOrZero(providerResult.usage.cachedInputTokens),
						)
					: undefined,
			billedCharacters: numberOrUndefined(providerResult.usage.billedCharacters),
			status: "completed",
		});
		return {
			entries: missingSegments.map((segment, index) => ({
				id: segment.id,
				text: segment.text,
				translation: validateTranslationOutput(
					providerResult.translations[index],
					segment.text,
				),
			})),
			usage: providerResult.usage,
		};
	}

	async function persistTranslation(
		context,
		snapshot,
		cachedTranslations,
		missingSegments,
		translatedBatch,
		usePersistentCache,
	) {
		const { settings, request } = context;
		const tasks = [
			usageStore.record(settings.provider, {
				apiCalls: 1,
				charactersSubmitted: sumSegmentCharacters(missingSegments),
				cachedCharacters: request.segments
					.filter((segment) => cachedTranslations.has(segment.id))
					.reduce((sum, segment) => sum + segment.text.length, 0),
				...translatedBatch.usage,
			}),
		];
		if (usePersistentCache) {
			tasks.push(
				cacheStore.store(
					settings,
					request.sourceLanguage,
					request.targetLanguage,
					translatedBatch.entries,
					snapshot.cacheScope,
					snapshot.cacheGeneration,
				),
			);
		}
		await Promise.allSettled(tasks);
	}

	function recordBatchReceived(context) {
		debug.record({
			...debugFields(context, "background", "batch.received"),
			extensionVersion,
			sourceLanguage: context.request.sourceLanguage,
			targetLanguage: context.request.targetLanguage,
			status: "started",
		});
	}

	function recordBatchCompleted(context, cacheHits, cacheMisses) {
		debug.record({
			...debugFields(context, "background", "batch.completed"),
			cacheHits,
			cacheMisses,
			status: "completed",
		});
	}

	function debugFields(context, component, eventType) {
		return {
			component,
			eventType,
			tabId: context.tabId,
			runId: context.request.runId,
			provider: context.settings.provider,
			model: core.getProviderModel(context.settings),
			segmentCount: context.request.segments.length,
			sourceCharacters: context.sourceCharacters,
			batchIndex: context.batchIndex,
			queueDepth: context.queueDepth,
		};
	}

	function validateTranslationOutput(value, sourceText) {
		if (typeof value !== "string") {
			throw new Error("翻译服务返回了无效译文");
		}
		const translation = value.trim();
		if (!translation || translation.length > core.getMaximumTranslationLength(sourceText.length)) {
			throw new Error("翻译服务返回的译文长度异常");
		}
		return translation;
	}

	return { recordFailure, translate };
}

function assertNotAborted(signal) {
	if (!signal?.aborted) {
		return;
	}
	throw signal.reason instanceof Error ? signal.reason : new Error("翻译已取消");
}

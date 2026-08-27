import { NETWORK_LIMITS } from "../constants.js";
import {
	abortableDelay,
	createModelProviderError,
	getErrorStatus,
	getModelRetryAfterMs,
	getSafeErrorCode,
	isRetryableError,
} from "../request-errors.js";
import { createIdentifier, numberOrUndefined } from "../utilities.js";
import {
	addUsage,
	attachTranslationUsage,
	createModelRequest,
	getResultUsage,
	getUnknownRequestUsage,
	MAX_OUTPUT_RECOVERY_SPLITS,
	splitSegmentBatch,
	splitSingleSegment,
} from "./model-translation-recovery.js";

export function createModelTranslator({ core, providerRuntime, debug, debugMetadata }) {
	async function translate(
		settings,
		sourceLanguage,
		targetLanguage,
		segments,
		signal,
		debugMetadataFields = {},
	) {
		if (!providerRuntime || typeof providerRuntime.generateTranslation !== "function") {
			throw new Error("模型 Provider 运行时未加载");
		}
		const providerId = settings.provider;
		const providerSettings = settings[providerId];
		const incognito = debugMetadataFields.incognito === true;
		const requestPayloadAllowed =
			settings.debugLogging === true &&
			settings.debugRequestPayload === true &&
			!incognito;
		const requestDebug = debugMetadata.createRequestContext(
			settings,
			"translate",
			sourceLanguage,
			targetLanguage,
			segments,
			{ ...debugMetadataFields, incognito, requestPayloadAllowed },
		);
		return await translateWithRecovery({
			settings,
			providerId,
			providerSettings,
			sourceLanguage,
			targetLanguage,
			segments,
			signal,
			requestDebug,
			requestPayloadAllowed,
			recoveryState: {
				remainingSplits: MAX_OUTPUT_RECOVERY_SPLITS,
				nextSplitId: 0,
			},
		});
	}

	async function translateWithRecovery(context) {
		const request = createModelRequest(context);
		const { result, apiCalls } = await generateWithRetry(
			request,
			context.signal,
			context.requestDebug,
		);
		const usage = getResultUsage(result, apiCalls, request.sourceCharacters);
		if (result.finishReason === "length") {
			recordTruncatedResponse(context.requestDebug, result, usage);
			return await recoverTruncatedTranslation(context, usage);
		}
		if (!result.text) {
			throw attachTranslationUsage(
				new Error(`${core.getProviderLabel(context.settings)} 未返回译文`),
				usage,
			);
		}
		if (result.finishReason !== "stop") {
			throw attachTranslationUsage(
				new Error(`${core.getProviderLabel(context.settings)} 未完整返回译文`),
				usage,
			);
		}
		recordValidatedResponse(context.requestDebug, result, usage);
		try {
			return {
				translations: core.parseModelTranslations(
					result.text,
					context.segments.map((segment) => segment.id),
				),
				usage,
			};
		} catch (error) {
			throw attachTranslationUsage(error, usage);
		}
	}

	async function recoverTruncatedTranslation(context, truncatedUsage) {
		if (context.recoveryState.remainingSplits <= 0) {
			throw attachTranslationUsage(
				new Error(
					`${core.getProviderLabel(context.settings)} 译文达到输出上限，插件已自动缩小批次但仍未完成`,
				),
				truncatedUsage,
			);
		}
		context.recoveryState.remainingSplits -= 1;
		const splitId = context.recoveryState.nextSplitId;
		context.recoveryState.nextSplitId += 1;
		const singleSegment = context.segments.length === 1;
		const groups = singleSegment
			? splitSingleSegment(core, context.segments[0], splitId)
			: splitSegmentBatch(context.segments);
		if (groups.length < 2) {
			throw attachTranslationUsage(
				new Error(`${core.getProviderLabel(context.settings)} 译文达到输出上限`),
				truncatedUsage,
			);
		}

		let usage = truncatedUsage;
		const translations = [];
		for (const segments of groups) {
			let recovered;
			try {
				recovered = await translateWithRecovery({ ...context, segments });
			} catch (error) {
				throw attachTranslationUsage(error, usage);
			}
			translations.push(...recovered.translations);
			usage = addUsage(usage, recovered.usage);
		}
		return {
			translations: singleSegment
				? [translations.join(context.targetLanguage === "zh" ? "" : " ")]
				: translations,
			usage,
		};
	}

	function recordTruncatedResponse(requestDebug, result, usage) {
		debug.recordRequest(requestDebug, {
			eventType: "model.response.truncated",
			finishReason: result.finishReason,
			rawFinishReason: result.rawFinishReason,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			status: "recovering",
		});
	}

	function recordValidatedResponse(requestDebug, result, usage) {
		debug.recordRequest(requestDebug, {
			eventType: "model.response.validated",
			responseId: result.responseId,
			responseModel: result.responseModel,
			finishReason: result.finishReason,
			rawFinishReason: result.rawFinishReason,
			warningCount: result.warningCount,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheReadTokens: usage.cachedInputTokens,
			cacheWriteTokens: numberOrUndefined(result.usage?.cacheWriteTokens),
			noCacheTokens: numberOrUndefined(result.usage?.noCacheTokens),
			status: "completed",
		});
	}

	async function generateWithRetry(request, signal, requestDebug) {
		if (signal.aborted) {
			throw signal.reason instanceof Error ? signal.reason : new Error("翻译已取消");
		}
		const requestId = createIdentifier();
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const attemptNumber = attempt + 1;
			const startedAt = Date.now();
			debug.recordRequest(requestDebug, {
				eventType: "model.request.started",
				requestId,
				attempt: attemptNumber,
				timeoutMs: NETWORK_LIMITS.modelRequestTimeoutMs,
				status: "started",
			});
			try {
				const result = await runAttempt(request, signal, (event) => {
					debug.recordRequest(requestDebug, {
						...event,
						eventType: `sdk.${event.eventType}`,
						endpoint: debug.getSafeEndpoint(event.endpoint),
						attempt: attemptNumber,
						timeoutMs: NETWORK_LIMITS.modelRequestTimeoutMs,
					});
				});
				debug.recordRequest(requestDebug, {
					eventType: "model.request.completed",
					requestId,
					attempt: attemptNumber,
					elapsedMs: Date.now() - startedAt,
					timeoutMs: NETWORK_LIMITS.modelRequestTimeoutMs,
					status: "completed",
				});
				return { result, apiCalls: attemptNumber };
			} catch (error) {
				const retryable = isRetryableError(error);
				debug.recordRequest(requestDebug, {
					eventType: "model.request.failed",
					requestId,
					attempt: attemptNumber,
					httpStatus: getErrorStatus(error),
					elapsedMs: Date.now() - startedAt,
					timeoutMs: NETWORK_LIMITS.modelRequestTimeoutMs,
					status: signal.aborted ? "cancelled" : "failed",
					errorCode: getSafeErrorCode(error),
					retryable,
					cancelled: signal.aborted,
				});
				if (signal.aborted || !retryable || attempt === 2) {
					throw attachTranslationUsage(
						createModelProviderError(error),
						getUnknownRequestUsage(attemptNumber, request.sourceCharacters),
					);
				}
				const retryAfterMs = getModelRetryAfterMs(error, core.isRecord);
				if (retryAfterMs > NETWORK_LIMITS.maxRetryDelayMs) {
					throw attachTranslationUsage(
						new Error(`翻译服务限流，请在 ${Math.ceil(retryAfterMs / 1_000)} 秒后重试`),
						getUnknownRequestUsage(attemptNumber, request.sourceCharacters),
					);
				}
				const delayMs = retryAfterMs || 600 * 2 ** attempt + Math.round(Math.random() * 400);
				debug.recordRequest(requestDebug, {
					eventType: "model.request.retry-scheduled",
					requestId,
					attempt: attemptNumber,
					retryAfterMs: delayMs,
					status: "waiting",
				});
				try {
					await abortableDelay(delayMs, signal);
				} catch (error) {
					throw attachTranslationUsage(
						error,
						getUnknownRequestUsage(attemptNumber, request.sourceCharacters),
					);
				}
			}
		}
	}

	async function runAttempt(request, parentSignal, onRequestEvent) {
		if (parentSignal.aborted) {
			throw parentSignal.reason ?? new Error("翻译已取消");
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			const error = new Error("翻译请求超时");
			error.code = "REQUEST_TIMEOUT";
			controller.abort(error);
		}, NETWORK_LIMITS.modelRequestTimeoutMs);
		const abortFromParent = () => controller.abort(parentSignal.reason);
		parentSignal.addEventListener("abort", abortFromParent, { once: true });
		try {
			return await providerRuntime.generateTranslation({
				...request,
				abortSignal: controller.signal,
				onRequestEvent,
			});
		} catch (error) {
			if (parentSignal.aborted) {
				throw parentSignal.reason ?? new Error("翻译已取消");
			}
			if (controller.signal.aborted) {
				const timeoutError = new Error("翻译请求超时");
				timeoutError.code = "REQUEST_TIMEOUT";
				throw timeoutError;
			}
			throw error;
		} finally {
			clearTimeout(timeout);
			parentSignal.removeEventListener("abort", abortFromParent);
		}
	}

	return { translate };
}

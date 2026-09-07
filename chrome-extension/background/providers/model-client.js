import { NETWORK_LIMITS } from "../constants.js";
import {
	abortableDelay,
	createModelProviderError,
	getErrorStatus,
	getModelRetryAfterMs,
	getSafeErrorCode,
	isRetryableError,
} from "../request-errors.js";
import { createIdentifier } from "../utilities.js";
import { attachTranslationUsage, getUnknownRequestUsage } from "./model-usage.js";

const MAX_REQUEST_ATTEMPTS = 3;

export function createModelClient({ core, providerRuntime, debug }) {
	async function generateWithRetry(request, signal, requestDebug) {
		if (signal.aborted) {
			throw signal.reason instanceof Error ? signal.reason : new Error("翻译已取消");
		}
		const requestId = createIdentifier();
		for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
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
				if (signal.aborted || !retryable || attemptNumber === MAX_REQUEST_ATTEMPTS) {
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

	return { generateWithRetry };
}

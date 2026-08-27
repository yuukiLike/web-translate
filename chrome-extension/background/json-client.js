import { NETWORK_LIMITS } from "./constants.js";
import {
	abortableDelay,
	extractApiError,
	getErrorStatus,
	getSafeErrorCode,
	isRetryableError,
	parseRetryAfter,
} from "./request-errors.js";
import { createIdentifier, numberOrUndefined, numberOrZero } from "./utilities.js";

export function createJsonClient({ fetchImpl = globalThis.fetch, debug }) {
	async function fetchJsonWithRetry(url, init, signal, options = {}) {
		const timeoutMs = options.timeoutMs ?? NETWORK_LIMITS.requestTimeoutMs;
		const maximumResponseCharacters = options.maximumResponseCharacters ?? 2_000_000;
		const requestId = createIdentifier();
		const endpoint = debug.getSafeEndpoint(url);
		const method = typeof init.method === "string" ? init.method.toUpperCase() : "GET";

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const attemptNumber = attempt + 1;
			const startedAt = Date.now();
			let httpStatus;
			debug.recordRequest(options.debug, {
				eventType: "request.started",
				requestId,
				endpoint,
				method,
				attempt: attemptNumber,
				timeoutMs,
				status: "started",
			});
			try {
				const response = await fetchJson(
					url,
					init,
					signal,
					timeoutMs,
					maximumResponseCharacters,
				);
				httpStatus = response.status;
				const data =
					typeof options.validate === "function"
						? options.validate(response.data)
						: response.data;
				debug.recordRequest(options.debug, {
					eventType: "request.completed",
					requestId,
					endpoint,
					method,
					attempt: attemptNumber,
					httpStatus,
					elapsedMs: Date.now() - startedAt,
					timeoutMs,
					status: "completed",
				});
				return data;
			} catch (error) {
				const retryable = isRetryableError(error);
				debug.recordRequest(options.debug, {
					eventType: "request.failed",
					requestId,
					endpoint,
					method,
					attempt: attemptNumber,
					httpStatus: httpStatus ?? numberOrUndefined(getErrorStatus(error)),
					elapsedMs: Date.now() - startedAt,
					timeoutMs,
					status: signal.aborted ? "cancelled" : "failed",
					errorCode: getSafeErrorCode(error),
					retryable,
					cancelled: signal.aborted,
				});
				if (signal.aborted || !retryable || attempt === 2) {
					throw error;
				}
				const retryAfterMs = numberOrZero(error.retryAfterMs);
				if (retryAfterMs > NETWORK_LIMITS.maxRetryDelayMs) {
					throw new Error(`翻译服务限流，请在 ${Math.ceil(retryAfterMs / 1_000)} 秒后重试`);
				}
				const delayMs = retryAfterMs || 600 * 2 ** attempt + Math.round(Math.random() * 400);
				debug.recordRequest(options.debug, {
					eventType: "request.retry-scheduled",
					requestId,
					endpoint,
					method,
					attempt: attemptNumber,
					retryAfterMs: delayMs,
					status: "waiting",
				});
				await abortableDelay(delayMs, signal);
			}
		}
	}

	async function fetchJson(url, init, parentSignal, timeoutMs, maximumResponseCharacters) {
		if (parentSignal.aborted) {
			throw parentSignal.reason ?? new Error("翻译已取消");
		}
		const timeoutController = new AbortController();
		const timeout = setTimeout(
			() => timeoutController.abort(new Error("翻译请求超时")),
			timeoutMs,
		);
		const abortFromParent = () => timeoutController.abort(parentSignal.reason);
		parentSignal.addEventListener("abort", abortFromParent, { once: true });

		try {
			const response = await fetchImpl(url, { ...init, signal: timeoutController.signal });
			const body = await response.text();
			if (body.length > maximumResponseCharacters) {
				throw new Error("服务响应过大");
			}
			const { data, invalidJson } = parseJsonBody(body);
			if (!response.ok) {
				const error = new Error(extractApiError(response.status));
				error.status = response.status;
				const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
				if (retryAfterMs !== null) {
					error.retryAfterMs = retryAfterMs;
				}
				throw error;
			}
			if (invalidJson) {
				throw new Error(`翻译服务返回了无效 JSON（HTTP ${response.status}）`);
			}
			return { data, status: response.status };
		} catch (error) {
			if (timeoutController.signal.aborted && !parentSignal.aborted) {
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

	return { fetchJsonWithRetry };
}

function parseJsonBody(body) {
	if (!body) {
		return { data: {}, invalidJson: false };
	}
	try {
		return { data: JSON.parse(body), invalidJson: false };
	} catch {
		return { data: {}, invalidJson: true };
	}
}

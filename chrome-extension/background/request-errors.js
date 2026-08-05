export function getErrorStatus(error) {
	const status = error?.statusCode ?? error?.status;
	return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

export function getSafeErrorCode(error) {
	if (typeof error?.code === "string" && /^[A-Z0-9_-]{1,80}$/u.test(error.code)) {
		return error.code;
	}
	const status = getErrorStatus(error);
	if (typeof status === "number") {
		return `HTTP_${status}`;
	}
	return error?.name === "TypeError" ? "NETWORK_ERROR" : "REQUEST_ERROR";
}

export function extractApiError(status) {
	if (status === 401 || status === 403) {
		return `API Key 或账户配置无效（HTTP ${status}）`;
	}
	if (status === 429) {
		return "翻译服务请求过于频繁（HTTP 429）";
	}
	return `翻译服务暂时不可用（HTTP ${status}）`;
}

export function isRetryableError(error) {
	const status = getErrorStatus(error);
	return (
		error?.isRetryable === true ||
		error?.code === "REQUEST_TIMEOUT" ||
		error?.name === "TypeError" ||
		[408, 429, 500, 502, 503, 504].includes(status)
	);
}

export function parseRetryAfter(value) {
	if (!value) {
		return null;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1_000;
	}
	const date = Date.parse(value);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function getModelRetryAfterMs(error, isRecord) {
	if (typeof error?.retryAfterMs === "number" && Number.isFinite(error.retryAfterMs)) {
		return Math.max(0, error.retryAfterMs);
	}
	const headers = error?.responseHeaders;
	if (headers && typeof headers.get === "function") {
		return parseRetryAfter(headers.get("Retry-After")) ?? 0;
	}
	if (isRecord(headers)) {
		const value = headers["retry-after"] ?? headers["Retry-After"];
		return parseRetryAfter(typeof value === "string" ? value : null) ?? 0;
	}
	return 0;
}

export function createModelProviderError(error) {
	if (error?.code === "REQUEST_TIMEOUT" || error?.message === "翻译已取消") {
		return error;
	}
	const status = getErrorStatus(error);
	const safeError = new Error(
		typeof status === "number"
			? extractApiError(status)
			: "模型服务请求失败，请检查网络和 Provider 状态",
	);
	if (typeof status === "number") {
		safeError.status = status;
	}
	safeError.code = getSafeErrorCode(error);
	return safeError;
}

export function abortableDelay(milliseconds, signal) {
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timeout);
			reject(signal.reason ?? new Error("翻译已取消"));
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, milliseconds);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

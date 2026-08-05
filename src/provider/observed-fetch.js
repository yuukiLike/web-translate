let requestSequence = 0;

function sanitizeEndpoint(input) {
	let value = "";
	if (typeof input === "string" || input instanceof URL) {
		value = String(input);
	} else if (input && typeof input === "object" && typeof input.url === "string") {
		value = input.url;
	}
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}`;
	} catch {
		return "unknown";
	}
}

function getRequestMethod(input, init) {
	if (typeof init?.method === "string" && init.method) {
		return init.method.toUpperCase();
	}
	if (input && typeof input === "object" && typeof input.method === "string" && input.method) {
		return input.method.toUpperCase();
	}
	return "POST";
}

function emitRequestEvent(callback, event) {
	if (typeof callback !== "function") {
		return;
	}
	try {
		const result = callback(Object.freeze(event));
		if (result && typeof result.then === "function") {
			void result.catch(() => {});
		}
	} catch {
		// 观测回调不能改变请求结果。
	}
}

function isRetryableHttpStatus(status) {
	return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function createObservedFetch(onRequestEvent, options = {}) {
	const nativeFetch = globalThis.fetch;
	if (typeof nativeFetch !== "function") {
		throw new Error("The Fetch API is unavailable");
	}
	const captureRequestBody = options.captureRequestBody === true;
	return async (input, init) => {
		requestSequence += 1;
		const requestId = `provider-request-${Date.now()}-${requestSequence}`;
		const endpoint = sanitizeEndpoint(input);
		const method = getRequestMethod(input, init);
		const startedAt = Date.now();
		emitRequestEvent(onRequestEvent, {
			eventType: "request-start",
			requestId,
			endpoint,
			method,
			status: "started",
			...(captureRequestBody && typeof init?.body === "string"
				? { requestBody: init.body }
				: {}),
		});
		try {
			const response = await nativeFetch.call(globalThis, input, init);
			const succeeded = response.ok;
			emitRequestEvent(onRequestEvent, {
				eventType: "request-end",
				requestId,
				endpoint,
				method,
				httpStatus: response.status,
				elapsedMs: Math.max(0, Date.now() - startedAt),
				status: succeeded ? "success" : "error",
				...(succeeded ? {} : { errorCode: `http_${response.status}` }),
				retryable: !succeeded && isRetryableHttpStatus(response.status),
			});
			return response;
		} catch (error) {
			const aborted = error instanceof Error && error.name === "AbortError";
			emitRequestEvent(onRequestEvent, {
				eventType: "request-error",
				requestId,
				endpoint,
				method,
				elapsedMs: Math.max(0, Date.now() - startedAt),
				status: "error",
				errorCode: aborted ? "aborted" : "network_error",
				retryable: !aborted,
			});
			throw error;
		}
	};
}

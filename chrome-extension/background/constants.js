export const CACHE_LIMITS = Object.freeze({
	maxEntries: 750,
	maxBytes: 7_500_000,
	ttlMs: 90 * 24 * 60 * 60 * 1_000,
});

export const MESSAGE_LIMITS = Object.freeze({
	maxCharacters: 50_000,
	maxSegments: 120,
	maxSegmentCharacters: 30_000,
});

export const NETWORK_LIMITS = Object.freeze({
	requestTimeoutMs: 25_000,
	modelRequestTimeoutMs: 25_000,
	maxRetryDelayMs: 60_000,
});

export const STORAGE_KEYS = Object.freeze({
	cacheGeneration: "cache-generation",
	currentRunPrefix: "current-run:",
	runSnapshotPrefix: "run-snapshot:",
	debugEvents: "debug-events-v1",
});

export const DEBUG_LIMITS = Object.freeze({
	maxEvents: 300,
	maxBytes: 512_000,
});

export const DEBUG_PORT_NAME = "debug-events-v1";
export const DONE_STATUS_STABILITY_MS = 320;

export const ACTION_MENU_IDS = Object.freeze({
	debug: "action-debug-logging",
	openDebug: "action-open-debug-panel",
	version: "action-extension-version",
});

export const SAFE_ENDPOINT_SUFFIXES = Object.freeze([
	"/chat/completions",
	"/models",
	"/responses",
	"/messages",
	"/v2/translate",
	"/v2/usage",
	"/translate",
]);

export const DEBUG_STRING_FIELDS = Object.freeze([
	"timestamp",
	"workerInstanceId",
	"component",
	"eventType",
	"runId",
	"requestId",
	"provider",
	"model",
	"operation",
	"sourceLanguage",
	"targetLanguage",
	"method",
	"endpoint",
	"status",
	"errorCode",
	"extensionVersion",
	"catalogSourceSha",
	"providerAdapter",
	"apiHost",
	"inferencePolicy",
	"responseId",
	"responseModel",
	"finishReason",
	"rawFinishReason",
]);

export const DEBUG_NUMBER_FIELDS = Object.freeze([
	"seq",
	"tabId",
	"attempt",
	"segmentCount",
	"sourceCharacters",
	"cacheHits",
	"cacheMisses",
	"httpStatus",
	"elapsedMs",
	"timeoutMs",
	"retryAfterMs",
	"inputTokens",
	"outputTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"noCacheTokens",
	"billedCharacters",
	"warningCount",
	"configuredConcurrency",
	"batchIndex",
	"queueDepth",
]);

export const DEBUG_BOOLEAN_FIELDS = Object.freeze(["retryable", "cancelled"]);

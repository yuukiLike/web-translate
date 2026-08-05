export const DEBUG_EVENT_LIMIT = 300;

export const DEBUG_EVENT_NAMES = Object.freeze({
	"debug.logging-enabled": "调试记录已开启",
	"settings.saved": "设置已保存",
	"run.started": "页面任务开始",
	"batch.received": "收到翻译批次",
	"cache.resolved": "缓存检查完成",
	"model.request.started": "模型请求开始",
	"sdk.request-start": "HTTP 请求发出",
	"sdk.request-end": "HTTP 响应返回",
	"sdk.request-error": "HTTP 连接失败",
	"model.request.completed": "模型响应完成",
	"model.request.failed": "模型请求失败",
	"model.request.retry-scheduled": "模型请求等待重试",
	"model.response.validated": "模型响应已校验",
	"request.started": "翻译 API 请求发出",
	"request.completed": "翻译 API 响应返回",
	"request.failed": "翻译 API 请求失败",
	"request.retry-scheduled": "翻译 API 等待重试",
	"request-start": "HTTP 请求发出",
	"request-end": "HTTP 响应返回",
	"request-error": "HTTP 连接失败",
	"provider.usage": "用量已记录",
	"batch.completed": "翻译批次完成",
	"batch.failed": "翻译批次失败",
});

export const DEBUG_REQUEST_START_EVENTS = new Set([
	"sdk.request-start",
	"request.started",
	"request-start",
]);

export const DEBUG_REQUEST_END_EVENTS = new Set([
	"sdk.request-end",
	"request.completed",
	"request-end",
]);

export const DEBUG_REQUEST_ERROR_EVENTS = new Set([
	"sdk.request-error",
	"request.failed",
	"request-error",
]);

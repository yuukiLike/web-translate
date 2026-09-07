import { safeString } from "../core/value-utils.js";
import { DEBUG_EVENT_NAMES, DEBUG_REQUEST_START_EVENTS, DEBUG_REQUEST_END_EVENTS, DEBUG_REQUEST_ERROR_EVENTS } from "./debugConstants.js";
import { createDebugSearchText, debugFields, debugStatus, formatApiHost, formatDebugTime, formatEndpoint, normalizeDebugEvents, scalarText, urlParts, withUnit } from "./debugFormat.js";
import { createRequestCapture } from "./debugPayload.js";

const safeIds = (value) => Array.isArray(value) ? value.filter((id) => typeof id === "string").map((id) => id.slice(0, 300)) : [];

export function createDebugRequests(events) {
	const requests = new Map();
	for (const [index, event] of normalizeDebugEvents(events).entries()) {
		const eventName = scalarText(event.eventType) || scalarText(event.operation);
		const started = DEBUG_REQUEST_START_EVENTS.has(eventName);
		const completed = DEBUG_REQUEST_END_EVENTS.has(eventName);
		const failed = DEBUG_REQUEST_ERROR_EVENTS.has(eventName);
		if (!started && !completed && !failed) {
			continue;
		}
		const requestId = safeString(event.requestId, "", 300);
		const attempt =
			typeof event.attempt === "number" && Number.isFinite(event.attempt)
				? Math.max(0, Math.round(event.attempt))
				: 0;
		let key = requestId ? `${requestId}:${attempt}` : `request-event-${index}`;
		if (eventName.startsWith("model.response.") && event.modelRequestId) {
			const match = [...requests.entries()].reverse().find(([, request]) =>
				request.event.modelRequestId === event.modelRequestId &&
				(!event.attempt || request.event.attempt === event.attempt),
			);
			if (match) key = match[0];
		}
		const previous = requests.get(key);
		if (eventName === "model.response.validated" && !previous) continue;
		const eventNames = previous ? [...previous.eventNames, eventName] : [eventName];
		const mergedEvent = { ...(previous?.event || {}), ...event };
		if (previous && eventName.startsWith("model.response.")) {
			mergedEvent.requestId = previous.event.requestId;
		}
		let status = previous?.status || "pending";
		if (failed || debugStatus(event) === "error") {
			status = "error";
		} else if (completed) {
			status = "ok";
		}
		requests.set(key, {
			id: `request-${key}`,
			dateTime: previous?.dateTime || safeString(event.timestamp, "", 80),
			event: mergedEvent,
			eventNames,
			status,
		});
	}

	return [...requests.values()].map((request) => {
		const endpoint = formatEndpoint(request.event.endpoint);
		const endpointParts = urlParts(endpoint);
		const method = scalarText(request.event.method);
		const host = endpointParts?.host || formatApiHost(request.event.apiHost);
		const fields = debugFields(request.event);
		const row = {
			id: request.id,
			time: formatDebugTime(request.dateTime),
			dateTime: request.dateTime,
			name: [method, host].filter(Boolean).join(" ") || "Provider 请求",
			code: request.eventNames.join(" → "),
			summary: [
				endpointParts?.path || endpoint,
				[scalarText(request.event.provider), scalarText(request.event.model)]
					.filter(Boolean)
					.join(" / "),
				withUnit(request.event.elapsedMs, "ms"),
			]
				.filter(Boolean)
				.join(" · "),
			badge: requestBadge(request.event, request.status),
			status: request.status,
			fields,
			capture: createRequestCapture(request.event),
			runId: safeString(request.event.runId, "", 300),
			batchId: safeString(request.event.batchId, "", 300),
			modelRequestId: safeString(request.event.modelRequestId, "", 300),
			parentModelRequestId: safeString(request.event.parentModelRequestId, "", 300),
			recoveryDepth: request.event.recoveryDepth || 0,
			attempt: request.event.attempt || 1,
			segmentIds: safeIds(request.event.segmentIds),
			rootSegmentIds: safeIds(request.event.rootSegmentIds),
		};
		return { ...row, searchText: createDebugSearchText(row) };
	});
}

function requestBadge(event, status) {
	const hasHttpStatus = typeof event.httpStatus === "number";
	const errorCode = scalarText(event.errorCode);
	if (status === "error" && errorCode && (!hasHttpStatus || event.httpStatus < 400)) {
		return errorCode;
	}
	if (hasHttpStatus) return `HTTP ${event.httpStatus}`;
	if (status === "error") return DEBUG_EVENT_NAMES[event.eventType] || "请求失败";
	return status === "pending" ? "等待响应" : "完成";
}

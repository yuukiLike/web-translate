import { safeString } from "../core/value-utils.js";
import {
	DEBUG_EVENT_NAMES,
	DEBUG_REQUEST_END_EVENTS,
	DEBUG_REQUEST_ERROR_EVENTS,
	DEBUG_REQUEST_START_EVENTS,
} from "./debugConstants.js";
import {
	createDebugSearchText,
	debugFields,
	debugStatus,
	debugSummary,
	formatApiHost,
	formatDebugTime,
	formatEndpoint,
	normalizeDebugEvents,
	scalarText,
	urlParts,
	withUnit,
} from "./debugFormat.js";

export function createDebugRows(events) {
	return normalizeDebugEvents(events).map((event, index) => {
		const eventName = scalarText(event.eventType) || scalarText(event.operation) || "DEBUG_EVENT";
		const timestamp = safeString(event.timestamp, "", 80);
		const status = debugStatus(event);
		let id = `event-${index}`;
		if (typeof event.seq === "number" && Number.isFinite(event.seq)) {
			id = `event-${event.seq}`;
		} else if (timestamp) {
			id = `event-${timestamp}-${index}`;
		}
		const row = {
			id,
			time: formatDebugTime(event.timestamp),
			dateTime: timestamp,
			name: DEBUG_EVENT_NAMES[eventName] || eventName,
			code: eventName,
			summary: debugSummary(event, eventName),
			badge:
				status === "error"
					? "错误"
					: status === "pending"
						? "进行中"
						: scalarText(event.component) || "完成",
			status,
			fields: debugFields(event),
		};
		return { ...row, searchText: createDebugSearchText(row) };
	});
}

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
		const key = requestId ? `${requestId}:${attempt}` : `request-event-${index}`;
		const previous = requests.get(key);
		const eventNames = previous ? [...previous.eventNames, eventName] : [eventName];
		const mergedEvent = { ...(previous?.event || {}), ...event };
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

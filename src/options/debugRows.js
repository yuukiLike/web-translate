import { safeString } from "../core/value-utils.js";
import { DEBUG_EVENT_NAMES } from "./debugConstants.js";
export { createDebugRequests } from "./debugRequests.js";
import {
	createDebugSearchText,
	debugFields,
	debugStatus,
	debugSummary,
	formatDebugTime,
	normalizeDebugEvents,
	scalarText,
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

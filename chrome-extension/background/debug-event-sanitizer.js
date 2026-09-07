import { DEBUG_BOOLEAN_FIELDS, DEBUG_NUMBER_FIELDS, DEBUG_STRING_FIELDS } from "./constants.js";
import { createSafeContentAliases, createSafeContentTrace, safeIdentifiers } from "./content-trace-sanitizer.js";
import { createSafeRequestPayload, normalizeOmittedFields } from "./request-payload-sanitizer.js";

const ID_LIST_FIELDS = ["segmentIds", "rootSegmentIds", "cacheHitIds", "cacheMissIds"];

export function createSafeDebugEvent(event, requestPayloadEnabled) {
	const safe = {};
	for (const field of DEBUG_STRING_FIELDS) {
		if (typeof event[field] === "string" && event[field]) {
			safe[field] = event[field].slice(0, field === "endpoint" ? 2_048 : 300);
		}
	}
	for (const field of DEBUG_NUMBER_FIELDS) {
		if (typeof event[field] === "number" && Number.isFinite(event[field])) {
			safe[field] = Math.max(0, Math.round(event[field]));
		}
	}
	for (const field of DEBUG_BOOLEAN_FIELDS) {
		if (typeof event[field] === "boolean") safe[field] = event[field];
	}
	for (const field of ID_LIST_FIELDS) {
		if (Array.isArray(event[field])) safe[field] = safeIdentifiers(event[field]);
	}
	const allowed = requestPayloadEnabled &&
		event.requestPayloadAllowed === true &&
		event.incognito === false &&
		safe.provider === "deepseek";
	if (!allowed) return safe;
	if (safe.eventType === "sdk.request-start") addRequestPayload(safe, event);
	if (safe.eventType === "content.planned") {
		const trace = createSafeContentTrace(event.contentTrace);
		if (trace) safe.contentTrace = trace;
	}
	if (safe.eventType === "content.alias") {
		const aliases = createSafeContentAliases(event.contentAliases);
		if (aliases) safe.contentAliases = aliases;
		if (event.contentAliasesTruncated === true || event.contentAliases?.length > (aliases?.length ?? 0)) {
			safe.contentAliasesTruncated = true;
		}
	}
	if (safe.requestPayload || safe.contentTrace || safe.contentAliases) {
		safe.requestPayloadAllowed = true;
		safe.incognito = false;
	}
	return safe;
}

function addRequestPayload(safe, event) {
	const result = createSafeRequestPayload(event.requestBody ?? event.requestPayload);
	if (!result) return;
	safe.requestPayload = result.payload;
	if (result.truncated || event.requestPayloadTruncated === true) safe.requestPayloadTruncated = true;
	const previousOmissions = Array.isArray(event.requestPayloadOmittedFields)
		? event.requestPayloadOmittedFields : [];
	const omitted = [...result.omittedFields, ...previousOmissions];
	const safeNames = normalizeOmittedFields(omitted);
	if (safeNames.length) safe.requestPayloadOmittedFields = safeNames;
}

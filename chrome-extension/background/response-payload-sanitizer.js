import { DEBUG_LIMITS } from "./constants.js";
import { estimateStorageBytes } from "./utilities.js";

// DeepSeek Chat Completions 响应的可记录字段；未知字段只保留安全名称。
const RESPONSE_SCHEMA = {
	id: "string", object: "string", created: "number", model: "string",
	choices: [{
		index: "number", finish_reason: "string",
		message: { role: "string", content: "text" },
	}],
	usage: {
		prompt_tokens: "number", completion_tokens: "number", total_tokens: "number",
		prompt_cache_hit_tokens: "number", prompt_cache_miss_tokens: "number",
		prompt_tokens_details: { cached_tokens: "number" },
		completion_tokens_details: { reasoning_tokens: "number" },
	},
	error: { code: "scalar", type: "string", message: "text", param: "string" },
};
const FIELD_NAMES = new Set([
	"id", "object", "created", "model", "choices", "index", "finish_reason", "message",
	"role", "content", "usage", "prompt_tokens", "completion_tokens", "total_tokens",
	"prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "prompt_tokens_details",
	"cached_tokens", "completion_tokens_details", "reasoning_tokens", "error", "code",
	"type", "param", "reasoning_content", "tool_calls", "logprobs", "other_field",
]);
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const fieldName = (value) => FIELD_NAMES.has(value) ? value : "other_field";

export function normalizeResponseOmittedFields(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.slice(0, 64)
		.filter((field) => typeof field === "string")
		.map((field) => field.split(".").slice(0, 4).map(fieldName).join(".")))];
}

function projectObject(source, schema, path, state) {
	const target = {};
	for (const [key, value] of Object.entries(source)) {
		const fieldPath = [...path, fieldName(key)];
		const rule = Object.hasOwn(schema, key) ? schema[key] : undefined;
		if (!rule) {
			state.omitted.add(fieldPath.join("."));
			continue;
		}
		if (Array.isArray(rule) && Array.isArray(value)) {
			const items = value.slice(0, DEBUG_LIMITS.maxResponseChoices);
			state.truncated ||= items.length < value.length || items.some((item) => !isRecord(item));
			target[key] = items.filter(isRecord).map((item) => projectObject(item, rule[0], fieldPath, state));
		} else if (isRecord(rule) && isRecord(value)) {
			target[key] = projectObject(value, rule, fieldPath, state);
		} else if (value === null && typeof rule === "string") {
			target[key] = null;
		} else if (rule === "text" && typeof value === "string") {
			target[key] = "";
			state.texts.push({ target, key, value });
		} else if (["string", "scalar"].includes(rule) && typeof value === "string") {
			target[key] = value.slice(0, 300);
			state.truncated ||= target[key].length < value.length;
		} else if (["number", "scalar"].includes(rule) && typeof value === "number" && Number.isFinite(value)) {
			target[key] = value;
		} else {
			state.omitted.add(fieldPath.join("."));
		}
	}
	return target;
}

function addTextWithinBudget(payload, { target, key, value }) {
	const limit = DEBUG_LIMITS.maxResponsePayloadBytes;
	target[key] = value.slice(0, limit);
	if (estimateStorageBytes(payload) <= limit) return target[key].length < value.length;
	let minimum = 0;
	let maximum = target[key].length;
	while (minimum < maximum) {
		const middle = Math.ceil((minimum + maximum) / 2);
		target[key] = value.slice(0, middle);
		if (estimateStorageBytes(payload) <= limit) minimum = middle;
		else maximum = middle - 1;
	}
	target[key] = value.slice(0, minimum);
	return minimum < value.length;
}

export function createSafeResponsePayload(value) {
	let source = value;
	if (typeof source === "string") {
		try {
			source = JSON.parse(source);
		} catch {
			return undefined;
		}
	}
	if (!isRecord(source)) return undefined;
	const state = { truncated: false, omitted: new Set(), texts: [] };
	const payload = projectObject(source, RESPONSE_SCHEMA, [], state);
	if (Object.keys(payload).length === 0) return undefined;
	for (const text of state.texts) {
		// 每次都填入正文；不能用 ||= 短路跳过后续 choices。
		const shortened = addTextWithinBudget(payload, text);
		state.truncated ||= shortened;
	}
	return {
		payload,
		truncated: state.truncated,
		omittedFields: normalizeResponseOmittedFields([...state.omitted]),
	};
}

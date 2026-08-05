export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeString(value, fallback = "", maximumLength = 500) {
	return typeof value === "string" ? value.trim().slice(0, maximumLength) : fallback;
}

export function clampInteger(value, fallback, minimum, maximum) {
	const number = typeof value === "number" ? value : Number.parseInt(String(value), 10);
	if (!Number.isFinite(number)) {
		return fallback;
	}
	return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

export function getMonthKey(date = new Date()) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorText(error) {
	return error instanceof Error && error.message ? error.message : "未知错误";
}

export function formatNumber(value) {
	const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
	return new Intl.NumberFormat("zh-CN").format(number);
}

export function shortText(value, maximumLength) {
	return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

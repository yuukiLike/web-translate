export function errorText(error) {
	return error instanceof Error && error.message ? error.message : "未知错误";
}

export function formatNumber(value) {
	const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
	return new Intl.NumberFormat("zh-CN").format(number);
}

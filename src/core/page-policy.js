const LOCAL_SUFFIXES = ["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "home.arpa", "corp", "private", "test", "invalid"];

/** 页面读取与用户配置的 API 端点是两个边界；此规则只用于网页来源。 */
export function getPageAccessError(value) {
	if (typeof value !== "string") return "无法确认网页来源，请刷新网页后重试";
	let url;
	try {
		url = new URL(value);
	} catch {
		return "无法确认网页来源，请刷新网页后重试";
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		return "为保护本地资料，仅支持 HTTP(S) 网页，不读取本地文件";
	}
	const host = url.hostname.toLowerCase().replace(/\.$/u, "");
	// URL 已规范化十进制、十六进制和缩写 IPv4。所有 IP 直连均拒绝，包含 IPv6 映射地址。
	if (!host.includes(".") || /^[\d.]+$/u.test(host) || host.includes(":")) {
		return "为保护本地资料，不读取本地域名或 IP 地址页面";
	}
	if (LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
		return "为保护本地资料，不读取本地域名或 IP 地址页面";
	}
	if (url.username || url.password) return "不读取地址中包含凭据的网页";
	return "";
}

export function getPageOrigin(value) {
	return getPageAccessError(value) ? "" : new URL(value).origin;
}

import { MODEL_PROVIDER_IDS } from "./optionDefinitions.js";
import { formatNumber, isRecord } from "./formatters.js";

const TOKEN_USAGE_PROVIDERS = new Set([...MODEL_PROVIDER_IDS, "custom"]);

function metric(label, value) {
	return { label, value };
}

export function createUsageRows(allUsage, monthKey, getProviderName) {
	if (!isRecord(allUsage)) {
		return [];
	}
	const monthUsage = allUsage[monthKey];
	if (!isRecord(monthUsage)) {
		return [];
	}
	return Object.entries(monthUsage).map(([id, value]) => {
		const usage = isRecord(value) ? value : {};
		let finalMetric = metric("计费字符", formatNumber(usage.billedCharacters));
		if (TOKEN_USAGE_PROVIDERS.has(id)) {
			const input = formatNumber(usage.inputTokens);
			const output = formatNumber(usage.outputTokens);
			finalMetric = metric("输入 / 输出 token", `${input} / ${output}`);
		}
		let name = id;
		if (typeof getProviderName === "function") {
			const candidate = getProviderName(id);
			if (typeof candidate === "string" && candidate) {
				name = candidate;
			}
		}
		return {
			id,
			name,
			metrics: [
				metric("API 请求", formatNumber(usage.apiCalls)),
				metric("提交字符", formatNumber(usage.charactersSubmitted)),
				metric("缓存命中", formatNumber(usage.cachedCharacters)),
				finalMetric,
			],
		};
	});
}

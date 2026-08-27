import { MODEL_PROVIDER_IDS } from "../core/constants.js";
import { isRecord } from "../core/value-utils.js";
import { formatNumber } from "./formatters.js";

const TOKEN_USAGE_PROVIDERS = new Set([...MODEL_PROVIDER_IDS, "custom"]);

function metric(label, value) {
	return { label, value };
}

function tokenCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function tokenUsageText(usage) {
	const input = tokenCount(usage.inputTokens);
	const output = tokenCount(usage.outputTokens);
	const apiCalls = tokenCount(usage.apiCalls) ?? 0;
	const missingCalls = tokenCount(usage.tokenUsageMissingCalls) ?? 0;
	if (input === undefined && output === undefined) {
		return apiCalls > 0 ? "未知" : "0 / 0";
	}
	if (input === 0 && output === 0 && apiCalls > 0) {
		return "未知";
	}
	const value = `${input === undefined ? "未知" : formatNumber(input)} / ${
		output === undefined ? "未知" : formatNumber(output)
	}`;
	return missingCalls > 0 ? `${value}（部分未知）` : value;
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
			finalMetric = metric("输入 / 输出 token", tokenUsageText(usage));
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

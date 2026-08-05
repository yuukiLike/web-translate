import { MODEL_PROVIDER_IDS } from "./optionDefinitions.js";
import { formatNumber, isRecord, shortText } from "./formatters.js";

function formatDecimal(value) {
	if (!Number.isFinite(value)) {
		return "—";
	}
	return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
}

function formatCostPair(cost) {
	if (!isRecord(cost)) {
		return "";
	}
	if (!Number.isFinite(cost.input) && !Number.isFinite(cost.output)) {
		return "";
	}
	return `$${formatDecimal(cost.input)} / $${formatDecimal(cost.output)}`;
}

function formatContextSize(limits) {
	if (!isRecord(limits) || !Number.isFinite(limits.context)) {
		return "";
	}
	if (limits.context >= 1_000_000) {
		const millions = limits.context / 1_000_000;
		const text = Number.isInteger(millions) ? String(millions) : millions.toFixed(1);
		return `${text}M 上下文`;
	}
	if (limits.context >= 1_000) {
		return `${formatNumber(Math.round(limits.context / 1_000))}K 上下文`;
	}
	return `${formatNumber(limits.context)} 上下文`;
}

function catalogModel(entryId, value) {
	if (!isRecord(value)) {
		return undefined;
	}
	const id = shortText(value.id, 300) || shortText(entryId, 300);
	if (!id) {
		return undefined;
	}
	const name = shortText(value.name, 180) || id;
	const costText = formatCostPair(isRecord(value.cost) ? value.cost : {});
	const contextText = formatContextSize(isRecord(value.limits) ? value.limits : {});
	const chips = [costText, contextText].filter(Boolean);
	const label = chips.length > 0 ? `${name} · ${chips.join(" · ")}` : name;
	return {
		id,
		name,
		label,
		optionLabel: name,
		costText,
		contextText,
		chips,
	};
}

function catalogDate(value) {
	const raw = shortText(value, 80);
	if (!raw) {
		return { dateText: "未知", dateTime: "" };
	}
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) {
		return { dateText: raw, dateTime: "" };
	}
	const dateTime = date.toISOString();
	const dateText = new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
	return { dateText, dateTime };
}

export function createCatalogInfo(catalog) {
	const models = Object.fromEntries(MODEL_PROVIDER_IDS.map((id) => [id, []]));
	const missingMessage = "固定本地模型目录未载入。请重新构建并重新加载扩展。";
	if (!isRecord(catalog) || !isRecord(catalog.providers)) {
		return {
			sha: "未知",
			dateText: "未知",
			dateTime: "",
			error: missingMessage,
			models,
		};
	}

	const source = isRecord(catalog.source) ? catalog.source : {};
	const commit = shortText(source.commit, 100);
	const date = catalogDate(source.fetchedAt);
	let complete = true;
	for (const id of MODEL_PROVIDER_IDS) {
		const provider = catalog.providers[id];
		if (!isRecord(provider) || !isRecord(provider.models)) {
			complete = false;
			continue;
		}
		const providerModels = Object.entries(provider.models)
			.map(([entryId, model]) => catalogModel(entryId, model))
			.filter((model) => model !== undefined);
		const defaultId = shortText(provider.defaultModelId, 300);
		providerModels.sort((left, right) => {
			if (left.id === defaultId) {
				return -1;
			}
			if (right.id === defaultId) {
				return 1;
			}
			return 0;
		});
		models[id] = providerModels;
		if (providerModels.length === 0) {
			complete = false;
		}
	}

	return {
		sha: commit ? commit.slice(0, 8) : "未知",
		dateText: date.dateText,
		dateTime: date.dateTime,
		error: complete ? "" : missingMessage,
		models,
	};
}

function defaultModelId(catalog, providerId) {
	if (!isRecord(catalog) || !isRecord(catalog.providers)) {
		return "";
	}
	const provider = catalog.providers[providerId];
	if (!isRecord(provider) || !isRecord(provider.models)) {
		return "";
	}
	const requested = shortText(provider.defaultModelId, 300);
	if (requested && Object.hasOwn(provider.models, requested)) {
		return requested;
	}
	for (const [entryId, model] of Object.entries(provider.models)) {
		const normalized = catalogModel(entryId, model);
		if (normalized) {
			return normalized.id;
		}
	}
	return "";
}

export function createFallbackSettings(catalog) {
	return {
		provider: "deepseek",
		targetMode: "auto",
		translateDynamicContent: true,
		concurrency: 2,
		debugLogging: false,
		azure: { apiKey: "", region: "" },
		deepl: { apiKey: "" },
		deepseek: { apiKey: "", model: defaultModelId(catalog, "deepseek") },
		openai: { apiKey: "", model: defaultModelId(catalog, "openai") },
		google: { apiKey: "", model: defaultModelId(catalog, "google") },
		anthropic: { apiKey: "", model: defaultModelId(catalog, "anthropic") },
		custom: { apiKey: "", baseUrl: "", model: "" },
	};
}

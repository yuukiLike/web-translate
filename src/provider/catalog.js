import providerAllowlist from "../../config/provider-allowlist.json";
import modelCatalog from "../../data/models-dev-subset.json";

const providerById = new Map(
	providerAllowlist.providers.map((provider) => [provider.id, Object.freeze({ ...provider })]),
);
const modelsByProviderId = new Map(
	modelCatalog.providers.map((provider) => [
		provider.id,
		new Map(provider.models.map((model) => [model.id, Object.freeze({ ...model })])),
	]),
);

export function getProviderAndModel(providerId, modelId) {
	const provider = providerById.get(providerId);
	if (!provider) {
		throw new Error(`Unsupported provider: ${String(providerId)}`);
	}
	const model = modelsByProviderId.get(providerId)?.get(modelId);
	if (!model) {
		throw new Error(`Model ${String(modelId)} is not allowlisted for provider ${providerId}`);
	}
	return { provider, model };
}

function normalizeCustomBaseUrl(value) {
	if (typeof value !== "string" || !value.trim()) {
		return "";
	}
	try {
		const url = new URL(value.trim());
		const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (!["https:", "http:"].includes(url.protocol)) {
			return "";
		}
		if (url.protocol === "http:" && !localHost) {
			return "";
		}
		if (url.username || url.password) {
			return "";
		}
		const path = url.pathname.replace(/\/+$/u, "");
		return `${url.origin}${path === "/" ? "" : path}`;
	} catch {
		return "";
	}
}

export function getCustomEndpoint(baseUrl, modelId) {
	const normalizedBaseUrl = normalizeCustomBaseUrl(baseUrl);
	const model = typeof modelId === "string" ? modelId.trim() : "";
	if (!normalizedBaseUrl) {
		throw new Error("A valid custom base URL is required");
	}
	if (!model || model.length > 300) {
		throw new Error("A valid custom model id is required");
	}
	return {
		provider: Object.freeze({ id: "custom", apiBaseURL: normalizedBaseUrl }),
		model: Object.freeze({ id: model, limits: Object.freeze({ output: 8_192 }) }),
	};
}

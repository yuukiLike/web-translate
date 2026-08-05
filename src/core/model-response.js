import { isRecord, safeString } from "./value-utils.js";

export function parseModelTranslations(content, expectedIds) {
	const raw = safeString(content, "", 1_000_000)
		.replace(/^```(?:json)?\s*/iu, "")
		.replace(/\s*```$/u, "");
	const firstBrace = raw.indexOf("{");
	const lastBrace = raw.lastIndexOf("}");
	if (firstBrace < 0 || lastBrace <= firstBrace) {
		throw new Error("模型未返回 JSON 对象");
	}

	let parsed;
	try {
		parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
	} catch {
		throw new Error("模型返回的 JSON 无法解析");
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.translations)) {
		throw new Error("模型返回中缺少 translations 数组");
	}
	if (
		parsed.translations.length !== expectedIds.length ||
		!parsed.translations.every(
			(item) => isRecord(item) && typeof item.id === "string" && typeof item.text === "string",
		)
	) {
		throw new Error("模型返回的译文数量与原文不一致");
	}

	const translations = new Map(parsed.translations.map((item) => [item.id, item.text.trim()]));
	if (translations.size !== expectedIds.length || expectedIds.some((id) => !translations.has(id))) {
		throw new Error("模型返回的译文 ID 与原文不一致");
	}
	return expectedIds.map((id) => translations.get(id));
}

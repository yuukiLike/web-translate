import { MESSAGE_LIMITS } from "./constants.js";

export function createMessageValidators(core) {
	function validateRunId(value) {
		if (typeof value !== "string" || !/^[a-z0-9-]{1,80}$/iu.test(value)) {
			throw new Error("无效任务 ID");
		}
		return value;
	}

	function validateLanguages(sourceLanguage, targetLanguage) {
		if (!["en", "zh"].includes(sourceLanguage) || !["en", "zh"].includes(targetLanguage)) {
			throw new Error("仅支持中英双语翻译");
		}
		if (sourceLanguage === targetLanguage) {
			throw new Error("源语言和目标语言不能相同");
		}
	}

	function validateSegments(value) {
		if (
			!Array.isArray(value) ||
			value.length === 0 ||
			value.length > MESSAGE_LIMITS.maxSegments
		) {
			throw new Error("翻译段落数量超出限制");
		}
		const seenIds = new Set();
		let characters = 0;
		const segments = value.map((segment) => {
			if (
				!core.isRecord(segment) ||
				typeof segment.id !== "string" ||
				typeof segment.text !== "string"
			) {
				throw new Error("翻译段落格式无效");
			}
			const id = segment.id.slice(0, 100);
			const text = core.normalizeSourceText(segment.text);
			if (
				!id ||
				seenIds.has(id) ||
				!text ||
				text.length > MESSAGE_LIMITS.maxSegmentCharacters
			) {
				throw new Error("翻译段落内容无效");
			}
			seenIds.add(id);
			characters += text.length;
			return { id, text };
		});
		if (characters > MESSAGE_LIMITS.maxCharacters) {
			throw new Error("单批翻译字符数超出限制");
		}
		return segments;
	}

	function validateTranslationRequest(message) {
		validateLanguages(message.sourceLanguage, message.targetLanguage);
		return {
			runId: validateRunId(message.runId),
			sourceLanguage: message.sourceLanguage,
			targetLanguage: message.targetLanguage,
			segments: validateSegments(message.segments),
		};
	}

	return { validateRunId, validateTranslationRequest };
}

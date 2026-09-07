import { numberOrUndefined } from "../utilities.js";
import { createModelClient } from "./model-client.js";
import { createModelRequest } from "./model-request.js";
import { addUsage, attachTranslationUsage, getResultUsage } from "./model-usage.js";
import {
	MAX_RESPONSE_RECOVERY_SPLITS,
	splitSegmentBatch,
	splitSingleSegment,
} from "./model-translation-recovery.js";

export function createModelTranslator({ core, providerRuntime, debug, debugMetadata }) {
	const modelClient = createModelClient({ core, providerRuntime, debug });

	async function translate(
		settings,
		sourceLanguage,
		targetLanguage,
		segments,
		signal,
		debugMetadataFields = {},
	) {
		if (!providerRuntime || typeof providerRuntime.generateTranslation !== "function") {
			throw new Error("模型 Provider 运行时未加载");
		}
		const providerId = settings.provider;
		const providerSettings = settings[providerId];
		const incognito = debugMetadataFields.incognito === true;
		const requestPayloadAllowed =
			settings.debugLogging === true &&
			settings.debugRequestPayload === true &&
			!incognito;
		const requestDebug = debugMetadata.createRequestContext(
			settings,
			"translate",
			sourceLanguage,
			targetLanguage,
			segments,
			{ ...debugMetadataFields, incognito, requestPayloadAllowed },
		);
		return await translateWithRecovery({
			settings,
			providerId,
			providerSettings,
			sourceLanguage,
			targetLanguage,
			segments,
			signal,
			requestDebug,
			requestPayloadAllowed,
			recoveryState: {
				remainingSplits: MAX_RESPONSE_RECOVERY_SPLITS,
				nextSplitId: 0,
			},
		});
	}

	async function translateWithRecovery(context) {
		const request = createModelRequest(context);
		const { result, apiCalls } = await modelClient.generateWithRetry(
			request,
			context.signal,
			context.requestDebug,
		);
		const usage = getResultUsage(result, apiCalls, request.sourceCharacters);
		if (result.finishReason === "length") {
			recordTruncatedResponse(context.requestDebug, result, usage);
			return await recoverTranslation(context, usage, "length");
		}
		if (!result.text) {
			throw attachTranslationUsage(
				new Error(`${core.getProviderLabel(context.settings)} 未返回译文`),
				usage,
			);
		}
		if (result.finishReason !== "stop") {
			throw attachTranslationUsage(
				new Error(`${core.getProviderLabel(context.settings)} 未完整返回译文`),
				usage,
			);
		}
		let translations;
		try {
			translations = core.parseModelTranslations(
				result.text,
				context.segments.map((segment) => segment.id),
			);
		} catch (error) {
			if (error?.code !== "MODEL_RESPONSE_INVALID") {
				throw attachTranslationUsage(error, usage);
			}
			debug.recordRequest(context.requestDebug, {
				eventType: "model.response.invalid",
				finishReason: result.finishReason,
				errorCode: error.code,
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				status: "recovering",
			});
			return await recoverTranslation(context, usage, "format");
		}
		recordValidatedResponse(context.requestDebug, result, usage);
		return { translations, usage };
	}

	async function recoverTranslation(context, failedUsage, reason) {
		if (context.recoveryState.remainingSplits <= 0) {
			throw attachTranslationUsage(
				createRecoveryError(context.settings, reason, true),
				failedUsage,
			);
		}
		context.recoveryState.remainingSplits -= 1;
		const splitId = context.recoveryState.nextSplitId;
		context.recoveryState.nextSplitId += 1;
		const singleSegment = context.segments.length === 1;
		const groups = singleSegment
			? splitSingleSegment(core, context.segments[0], splitId)
			: splitSegmentBatch(context.segments);
		if (groups.length < 2) {
			throw attachTranslationUsage(
				createRecoveryError(context.settings, reason),
				failedUsage,
			);
		}

		// 所有子批共用恢复预算，并在失败或取消时把已发生用量逐层带回。
		let usage = failedUsage;
		const translations = [];
		for (const segments of groups) {
			let recovered;
			try {
				recovered = await translateWithRecovery({ ...context, segments });
			} catch (error) {
				throw attachTranslationUsage(error, usage);
			}
			translations.push(...recovered.translations);
			usage = addUsage(usage, recovered.usage);
		}
		return {
			translations: singleSegment
				? [translations.join(context.targetLanguage === "zh" ? "" : " ")]
				: translations,
			usage,
		};
	}

	function createRecoveryError(settings, reason, exhausted = false) {
		const problem = reason === "length" ? "译文达到输出上限" : "返回的译文格式无效";
		const recovery = exhausted ? "，插件已自动缩小批次但仍未完成" : "";
		const error = new Error(`${core.getProviderLabel(settings)} ${problem}${recovery}`);
		if (reason === "format") error.code = "MODEL_RESPONSE_INVALID";
		return error;
	}

	function recordTruncatedResponse(requestDebug, result, usage) {
		debug.recordRequest(requestDebug, {
			eventType: "model.response.truncated",
			finishReason: result.finishReason,
			rawFinishReason: result.rawFinishReason,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			status: "recovering",
		});
	}

	function recordValidatedResponse(requestDebug, result, usage) {
		debug.recordRequest(requestDebug, {
			eventType: "model.response.validated",
			responseId: result.responseId,
			responseModel: result.responseModel,
			finishReason: result.finishReason,
			rawFinishReason: result.rawFinishReason,
			warningCount: result.warningCount,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheReadTokens: usage.cachedInputTokens,
			cacheWriteTokens: numberOrUndefined(result.usage?.cacheWriteTokens),
			noCacheTokens: numberOrUndefined(result.usage?.noCacheTokens),
			status: "completed",
		});
	}

	return { translate };
}

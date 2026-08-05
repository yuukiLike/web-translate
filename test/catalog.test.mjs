import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import Ajv2020 from "ajv/dist/2020.js";

import {
	loadValidatedConfiguration,
	validateCrossConstraints,
} from "../scripts/validate-provider-config.mjs";

const sourceCommit = "141191529fcad56200de45e7267a21dffcc4c33e";
const translationInstructions = "Translate the user content and return only the translation.";

async function readJson(relativePath) {
	return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

function createRuntimeContext(fetchImplementation) {
	const blockedFunctionConstructor = new Proxy(Function, {
		apply() {
			throw new EvalError("Dynamic code evaluation is blocked by the extension CSP");
		},
		construct() {
			throw new EvalError("Dynamic code evaluation is blocked by the extension CSP");
		},
	});
	const context = vm.createContext({
		AbortController,
		Blob,
		CompressionStream,
		Date,
		DecompressionStream,
		DOMException,
		Error,
		File,
		FormData,
		Function: blockedFunctionConstructor,
		Headers,
		ReadableStream,
		Request,
		Response,
		TextDecoder,
		TextEncoder,
		TransformStream,
		URL,
		URLSearchParams,
		WritableStream,
		clearTimeout,
		crypto,
		fetch: fetchImplementation,
		globalThis: null,
		performance,
		queueMicrotask,
		setTimeout,
		structuredClone,
	});
	context.globalThis = context;
	return context;
}

async function loadProviderRuntime(fetchImplementation) {
	const source = await readFile(
		new URL("../chrome-extension/generated/provider-runtime.js", import.meta.url),
		"utf8",
	);
	const context = createRuntimeContext(fetchImplementation);
	vm.runInContext(source, context, { filename: "provider-runtime.js" });
	return {
		context,
		runtime: context.BilingualTranslatorProviderRuntime,
	};
}

test("catalog and provider allowlist satisfy their strict JSON schemas", async () => {
	const [catalog, catalogSchema, allowlist, allowlistSchema] = await Promise.all([
		readJson("../data/models-dev-subset.json"),
		readJson("../schemas/model-catalog.schema.json"),
		readJson("../config/provider-allowlist.json"),
		readJson("../schemas/provider-allowlist.schema.json"),
	]);
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	const validateCatalog = ajv.compile(catalogSchema);
	const validateAllowlist = ajv.compile(allowlistSchema);

	assert.equal(validateCatalog(catalog), true);
	assert.equal(validateAllowlist(allowlist), true);

	const catalogWithoutStructuredOutput = structuredClone(catalog);
	delete catalogWithoutStructuredOutput.providers[0].models[0].capabilities.structuredOutput;
	assert.equal(validateCatalog(catalogWithoutStructuredOutput), false);

	const compatibleSdkAllowlist = structuredClone(allowlist);
	compatibleSdkAllowlist.providers[0].sdkPackage = "@ai-sdk/openai-compatible";
	assert.equal(validateAllowlist(compatibleSdkAllowlist), false);
});

test("cross-validation binds defaults, model ownership, SDK packages, and official APIs", async () => {
	const { catalog, allowlist } = await loadValidatedConfiguration();
	assert.equal(catalog.source.commit, sourceCommit);
	assert.doesNotThrow(() => validateCrossConstraints(catalog, allowlist));

	const missingDefault = structuredClone(allowlist);
	missingDefault.providers[0].defaultModelId = "deepseek-not-in-snapshot";
	assert.throws(
		() => validateCrossConstraints(catalog, missingDefault),
		/Default model deepseek-not-in-snapshot does not exist/u,
	);

	const mismatchedModel = structuredClone(catalog);
	mismatchedModel.providers[0].models[0].providerId = "openai";
	assert.throws(
		() => validateCrossConstraints(mismatchedModel, allowlist),
		/declares provider openai, expected deepseek/u,
	);

	const wrongSdk = structuredClone(allowlist);
	wrongSdk.providers[0].sdkPackage = "@ai-sdk/openai";
	assert.throws(
		() => validateCrossConstraints(catalog, wrongSdk),
		/must use SDK package @ai-sdk\/deepseek/u,
	);

	const wrongApi = structuredClone(allowlist);
	wrongApi.providers[0].apiBaseURL = "https://example.invalid/v1";
	assert.throws(
		() => validateCrossConstraints(catalog, wrongApi),
		/must use official API base URL https:\/\/api\.deepseek\.com/u,
	);
});

test("generated classic script exposes a deeply frozen provider catalog global", async () => {
	const source = await readFile(
		new URL("../chrome-extension/generated/provider-catalog.js", import.meta.url),
		"utf8",
	);
	const context = vm.createContext({ globalThis: null });
	context.globalThis = context;
	vm.runInContext(source, context, { filename: "provider-catalog.js" });

	const catalog = context.BilingualTranslatorProviderCatalog;
	assert.equal(catalog.source.commit, sourceCommit);
	assert.equal(catalog.defaultProviderId, "deepseek");
	assert.equal(catalog.providers.deepseek.defaultModelId, "deepseek-v4-flash");
	assert.equal(catalog.providers.openai.models["gpt-5.6-luna"].capabilities.structuredOutput, true);
	assert.equal(catalog.providers.google.models["gemini-3.5-flash-lite"].limits.context, 1048576);
	assert.equal(catalog.providers.anthropic.models["claude-sonnet-5"].cost.output, 10);
	assert.equal(Object.isFrozen(catalog), true);
	assert.equal(Object.isFrozen(catalog.providers.deepseek.models["deepseek-v4-flash"]), true);
});

test("generated runtime rejects providers and provider-model mismatches before fetch", async () => {
	let fetchCount = 0;
	const { runtime } = await loadProviderRuntime(async () => {
		fetchCount += 1;
		throw new Error("unexpected fetch");
	});

	await assert.rejects(
		runtime.generateTranslation({
			providerId: "openrouter",
			apiKey: "not-a-real-key",
			modelId: "openrouter/auto",
			instructions: translationInstructions,
			messages: [{ role: "user", content: "translate" }],
		}),
		/Unsupported provider: openrouter/u,
	);
	await assert.rejects(
		runtime.generateTranslation({
			providerId: "deepseek",
			apiKey: "not-a-real-key",
			modelId: "gpt-5.6-luna",
			instructions: translationInstructions,
			messages: [{ role: "user", content: "translate" }],
		}),
		/Model gpt-5\.6-luna is not allowlisted for provider deepseek/u,
	);
	assert.equal(fetchCount, 0);
});

test("DeepSeek requests disable thinking and expose only safe request metadata", async () => {
	const apiKey = "not-a-real-deepseek-key";
	const requests = [];
	const events = [];
	const { context, runtime } = await loadProviderRuntime(async (input, init) => {
		requests.push({ input: String(input), init });
		return new Response(
			JSON.stringify({
				id: "response-test-id",
				created: 1,
				model: "deepseek-v4-flash",
				choices: [
					{
						message: { role: "assistant", content: "译文" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 3,
					prompt_cache_hit_tokens: 2,
					total_tokens: 13,
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	});

	const result = await runtime.generateTranslation({
		providerId: "deepseek",
		apiKey,
		modelId: "deepseek-v4-flash",
		instructions: translationInstructions,
		messages: [{ role: "user", content: "Translate this" }],
		maxOutputTokens: 100,
		onRequestEvent(event) {
			events.push(event);
		},
	});
	const normalizedResult = JSON.parse(JSON.stringify(result));

	assert.equal(context.__zod_globalConfig.jitless, true);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].input, "https://api.deepseek.com/chat/completions");
	const requestBody = JSON.parse(requests[0].init.body);
	assert.deepEqual(requestBody.thinking, { type: "disabled" });
	assert.deepEqual(
		requestBody.messages.map((message) => message.role),
		["system", "user"],
	);
	assert.equal(requestBody.messages[0].content, translationInstructions);
	assert.equal(requestBody.messages[1].content, "Translate this");
	assert.equal(normalizedResult.text, "译文");
	assert.equal(normalizedResult.finishReason, "stop");
	assert.equal(normalizedResult.rawFinishReason, "stop");
	assert.equal(normalizedResult.responseId, "response-test-id");
	assert.equal(normalizedResult.responseModel, "deepseek-v4-flash");
	assert.deepEqual(normalizedResult.usage, {
		inputTokens: 10,
		outputTokens: 3,
		cacheReadTokens: 2,
		cacheWriteTokens: 0,
		noCacheTokens: 8,
	});
	assert.equal(normalizedResult.warningCount, 0);
	assert.deepEqual(
		events.map((event) => event.eventType),
		["request-start", "request-end"],
	);
	assert.equal(events[0].endpoint, "https://api.deepseek.com/chat/completions");
	assert.equal(events[1].httpStatus, 200);
	assert.equal(events[1].retryable, false);
	const safeEventFields = new Set([
		"elapsedMs",
		"endpoint",
		"errorCode",
		"eventType",
		"httpStatus",
		"method",
		"requestId",
		"retryable",
		"status",
	]);
	assert.ok(events.every((event) => Object.keys(event).every((key) => safeEventFields.has(key))));
	assert.equal(JSON.stringify(events).includes(apiKey), false);
});

test("OpenAI uses the Responses API with reasoning explicitly disabled", async () => {
	const requests = [];
	const { runtime } = await loadProviderRuntime(async (input, init) => {
		requests.push({ input: String(input), init });
		return new Response(
			JSON.stringify({
				id: "resp_mock",
				created_at: 1,
				model: "gpt-5.6-luna",
				output: [
					{
						type: "message",
						role: "assistant",
						id: "msg_mock",
						content: [{ type: "output_text", text: "译文", annotations: [] }],
					},
				],
				usage: {
					input_tokens: 10,
					output_tokens: 3,
					output_tokens_details: { reasoning_tokens: 0 },
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	});

	const result = await runtime.generateTranslation({
		providerId: "openai",
		apiKey: "not-a-real-openai-key",
		modelId: "gpt-5.6-luna",
		instructions: translationInstructions,
		messages: [{ role: "user", content: "Translate this" }],
	});
	const body = JSON.parse(requests[0].init.body);

	assert.equal(requests.length, 1);
	assert.equal(requests[0].input, "https://api.openai.com/v1/responses");
	assert.equal(body.model, "gpt-5.6-luna");
	assert.deepEqual(body.reasoning, { effort: "none" });
	assert.equal(result.text, "译文");
});

test("Google uses its explicit provider and minimal Gemini thinking", async () => {
	const requests = [];
	const { runtime } = await loadProviderRuntime(async (input, init) => {
		requests.push({ input: String(input), init });
		return new Response(
			JSON.stringify({
				candidates: [
					{
						content: { parts: [{ text: "译文" }] },
						finishReason: "STOP",
					},
				],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	});

	const result = await runtime.generateTranslation({
		providerId: "google",
		apiKey: "not-a-real-google-key",
		modelId: "gemini-3.5-flash-lite",
		instructions: translationInstructions,
		messages: [{ role: "user", content: "Translate this" }],
	});
	const body = JSON.parse(requests[0].init.body);

	assert.equal(requests.length, 1);
	assert.equal(
		requests[0].input,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
	);
	assert.deepEqual(body.generationConfig.thinkingConfig, {
		includeThoughts: false,
		thinkingLevel: "minimal",
	});
	assert.equal(result.text, "译文");
});

test("Anthropic uses Messages API with thinking explicitly disabled", async () => {
	const requests = [];
	const { runtime } = await loadProviderRuntime(async (input, init) => {
		requests.push({ input: String(input), init });
		return new Response(
			JSON.stringify({
				type: "message",
				id: "msg_mock",
				model: "claude-sonnet-5",
				content: [{ type: "text", text: "译文" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 3 },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	});

	const result = await runtime.generateTranslation({
		providerId: "anthropic",
		apiKey: "not-a-real-anthropic-key",
		modelId: "claude-sonnet-5",
		instructions: translationInstructions,
		messages: [{ role: "user", content: "Translate this" }],
	});
	const body = JSON.parse(requests[0].init.body);

	assert.equal(requests.length, 1);
	assert.equal(requests[0].input, "https://api.anthropic.com/v1/messages");
	assert.deepEqual(body.thinking, { type: "disabled" });
	assert.equal(result.text, "译文");
});

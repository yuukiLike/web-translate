import { readFile } from "node:fs/promises";
import vm from "node:vm";

const runtimeScriptUrl = new URL(
	"../../chrome-extension/generated/provider-runtime.js",
	import.meta.url,
);

export const translationInstructions =
	"Translate the user content and return only the translation.";

function createBlockedFunctionConstructor() {
	const rejectDynamicEvaluation = () => {
		throw new EvalError("扩展 CSP 禁止动态执行代码");
	};
	return new Proxy(Function, {
		apply: rejectDynamicEvaluation,
		construct: rejectDynamicEvaluation,
	});
}

function createRuntimeContext(fetchImplementation) {
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
		Function: createBlockedFunctionConstructor(),
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

export async function loadProviderRuntime(fetchImplementation) {
	const source = await readFile(runtimeScriptUrl, "utf8");
	const context = createRuntimeContext(fetchImplementation);
	vm.runInContext(source, context, { filename: "provider-runtime.js" });
	return {
		context,
		runtime: context.BilingualTranslatorProviderRuntime,
	};
}

export function createRequestRecorder(responseFactory) {
	const requests = [];
	return {
		requests,
		async fetchImplementation(input, init) {
			const request = { input: String(input), init };
			requests.push(request);
			return responseFactory(request);
		},
	};
}

export function createTranslationRequest(providerId, modelId, overrides = {}) {
	return {
		providerId,
		modelId,
		apiKey: `test-${providerId}-api-key`,
		instructions: translationInstructions,
		messages: [{ role: "user", content: "Translate this" }],
		...overrides,
	};
}

export function createJsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export function toPlainValue(value) {
	return JSON.parse(JSON.stringify(value));
}

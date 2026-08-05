import assert from "node:assert/strict";
import test from "node:test";

import { createDebugMetadata } from "../../chrome-extension/background/debug-metadata.js";
import {
	backgroundCatalog,
	backgroundCore,
} from "../helpers/background-harness.mjs";

// 验证自定义服务的调试元数据准确描述实际 Chat Completions 适配器和默认推理策略。
test("自定义服务调试元数据与真实适配器一致", () => {
	const defaults = backgroundCore.createDefaultSettings();
	const settings = backgroundCore.normalizeSettings({
		...defaults,
		provider: "custom",
		custom: {
			baseUrl: "https://custom.example/v1",
			model: "private-model",
			apiKey: "custom-secret",
		},
	});
	const metadata = createDebugMetadata({
		core: backgroundCore,
		providerCatalog: backgroundCatalog,
		extensionVersion: "0.4.0",
	});

	assert.deepEqual(metadata.createProviderContext(settings, "translate"), {
		component: "provider",
		provider: "custom",
		model: "private-model",
		extensionVersion: "0.4.0",
		providerAdapter: "@ai-sdk/openai:chat-custom",
		apiHost: "custom.example",
		inferencePolicy: "provider-default",
		catalogSourceSha: "",
		operation: "translate",
	});
});

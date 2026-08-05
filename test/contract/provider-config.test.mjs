import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import Ajv2020 from "ajv/dist/2020.js";

import {
	loadValidatedConfiguration,
	validateCrossConstraints,
} from "../../scripts/validate-provider-config.mjs";

const applicationRoot = new URL("../../", import.meta.url);
const sourceCommit = "141191529fcad56200de45e7267a21dffcc4c33e";

async function readJson(relativePath) {
	return JSON.parse(await readFile(new URL(relativePath, applicationRoot), "utf8"));
}

async function loadSchemaInputs() {
	return Promise.all([
		readJson("data/models-dev-subset.json"),
		readJson("schemas/model-catalog.schema.json"),
		readJson("config/provider-allowlist.json"),
		readJson("schemas/provider-allowlist.schema.json"),
	]);
}

function assertDeeplyFrozen(value, location = "catalog") {
	assert.equal(Object.isFrozen(value), true, `${location} 必须被冻结`);
	for (const [key, nested] of Object.entries(value)) {
		if (nested && typeof nested === "object") {
			assertDeeplyFrozen(nested, `${location}.${key}`);
		}
	}
}

// 验证配置不仅能通过 Schema，还会拒绝缺失字段、额外字段和非官方 SDK。
test("Provider 配置遵守严格 JSON Schema", async () => {
	const [catalog, catalogSchema, allowlist, allowlistSchema] = await loadSchemaInputs();
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	const validateCatalog = ajv.compile(catalogSchema);
	const validateAllowlist = ajv.compile(allowlistSchema);

	assert.equal(validateCatalog(catalog), true);
	assert.equal(validateAllowlist(allowlist), true);

	const missingCapability = structuredClone(catalog);
	delete missingCapability.providers[0].models[0].capabilities.structuredOutput;
	assert.equal(validateCatalog(missingCapability), false);

	const unexpectedCatalogField = structuredClone(catalog);
	unexpectedCatalogField.providers[0].models[0].undocumented = true;
	assert.equal(validateCatalog(unexpectedCatalogField), false);

	const unsupportedSdk = structuredClone(allowlist);
	unsupportedSdk.providers[0].sdkPackage = "@ai-sdk/openai-compatible";
	assert.equal(validateAllowlist(unsupportedSdk), false);
});

// 验证 Schema 之外的关联约束：快照来源、模型归属、默认模型、SDK 与官方 API。
test("Provider 配置满足跨文件关联约束", async () => {
	const { catalog, allowlist } = await loadValidatedConfiguration();
	assert.equal(catalog.source.commit, sourceCommit);
	assert.doesNotThrow(() => validateCrossConstraints(catalog, allowlist));

	const missingDefault = structuredClone(allowlist);
	missingDefault.providers[0].defaultModelId = "deepseek-not-in-snapshot";
	assert.throws(
		() => validateCrossConstraints(catalog, missingDefault),
		/Default model deepseek-not-in-snapshot does not exist/u,
	);

	const mismatchedOwner = structuredClone(catalog);
	mismatchedOwner.providers[0].models[0].providerId = "openai";
	assert.throws(
		() => validateCrossConstraints(mismatchedOwner, allowlist),
		/declares provider openai, expected deepseek/u,
	);

	const wrongSdk = structuredClone(allowlist);
	wrongSdk.providers[0].sdkPackage = "@ai-sdk/openai";
	assert.throws(
		() => validateCrossConstraints(catalog, wrongSdk),
		/must use SDK package @ai-sdk\/deepseek/u,
	);

	const wrongEndpoint = structuredClone(allowlist);
	wrongEndpoint.providers[0].apiBaseURL = "https://example.invalid/v1";
	assert.throws(
		() => validateCrossConstraints(catalog, wrongEndpoint),
		/must use official API base URL https:\/\/api\.deepseek\.com/u,
	);
});

// 验证生成脚本导出的目录从根对象到模型能力、成本和限制均不可变。
test("生成的 Provider 目录会被递归冻结", async () => {
	const source = await readFile(
		new URL("chrome-extension/generated/provider-catalog.js", applicationRoot),
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
	assert.equal(catalog.providers.google.models["gemini-3.5-flash-lite"].limits.context, 1_048_576);
	assert.equal(catalog.providers.anthropic.models["claude-sonnet-5"].cost.output, 10);
	assertDeeplyFrozen(catalog);
});

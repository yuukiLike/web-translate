import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(applicationRoot, "data/models-dev-subset.json");
const catalogSchemaPath = resolve(applicationRoot, "schemas/model-catalog.schema.json");
const allowlistPath = resolve(applicationRoot, "config/provider-allowlist.json");
const allowlistSchemaPath = resolve(applicationRoot, "schemas/provider-allowlist.schema.json");
const sourceCommit = "141191529fcad56200de45e7267a21dffcc4c33e";
const expectedProviders = Object.freeze({
	deepseek: Object.freeze({
		sdkPackage: "@ai-sdk/deepseek",
		apiBaseURL: "https://api.deepseek.com",
	}),
	openai: Object.freeze({
		sdkPackage: "@ai-sdk/openai",
		apiBaseURL: "https://api.openai.com/v1",
	}),
	google: Object.freeze({
		sdkPackage: "@ai-sdk/google",
		apiBaseURL: "https://generativelanguage.googleapis.com/v1beta",
	}),
	anthropic: Object.freeze({
		sdkPackage: "@ai-sdk/anthropic",
		apiBaseURL: "https://api.anthropic.com/v1",
	}),
});

async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, "utf8"));
}

function formatSchemaErrors(errors) {
	return errors
		.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
		.join("\n");
}

function assertSchema(validator, value, label) {
	if (!validator(value)) {
		throw new Error(`${label} failed schema validation:\n${formatSchemaErrors(validator.errors ?? [])}`);
	}
}

function assertUniqueId(map, id, label) {
	if (map.has(id)) {
		throw new Error(`Duplicate ${label} id: ${id}`);
	}
}

export function validateCrossConstraints(catalog, allowlist) {
	if (catalog.source.commit !== sourceCommit) {
		throw new Error(`Catalog source commit must be ${sourceCommit}`);
	}

	const catalogProviders = new Map();
	for (const provider of catalog.providers) {
		assertUniqueId(catalogProviders, provider.id, "catalog provider");
		const models = new Map();
		for (const model of provider.models) {
			if (model.providerId !== provider.id) {
				throw new Error(
					`Model ${model.id} declares provider ${model.providerId}, expected ${provider.id}`,
				);
			}
			assertUniqueId(models, model.id, `${provider.id} model`);
			models.set(model.id, model);
		}
		catalogProviders.set(provider.id, { provider, models });
	}

	const allowlistedProviders = new Map();
	for (const provider of allowlist.providers) {
		assertUniqueId(allowlistedProviders, provider.id, "allowlisted provider");
		const expected = expectedProviders[provider.id];
		if (!expected) {
			throw new Error(`Provider ${provider.id} is not one of the four supported providers`);
		}
		if (provider.sdkPackage !== expected.sdkPackage) {
			throw new Error(
				`Provider ${provider.id} must use SDK package ${expected.sdkPackage}, received ${provider.sdkPackage}`,
			);
		}
		if (provider.apiBaseURL !== expected.apiBaseURL) {
			throw new Error(
				`Provider ${provider.id} must use official API base URL ${expected.apiBaseURL}`,
			);
		}
		const catalogProvider = catalogProviders.get(provider.id);
		if (!catalogProvider) {
			throw new Error(`Allowlisted provider ${provider.id} is missing from the catalog`);
		}
		if (!catalogProvider.models.has(provider.defaultModelId)) {
			throw new Error(
				`Default model ${provider.defaultModelId} does not exist for provider ${provider.id}`,
			);
		}
		allowlistedProviders.set(provider.id, provider);
	}

	for (const providerId of Object.keys(expectedProviders)) {
		if (!catalogProviders.has(providerId)) {
			throw new Error(`Required catalog provider ${providerId} is missing`);
		}
		if (!allowlistedProviders.has(providerId)) {
			throw new Error(`Required allowlisted provider ${providerId} is missing`);
		}
	}
	for (const providerId of catalogProviders.keys()) {
		if (!allowlistedProviders.has(providerId)) {
			throw new Error(`Catalog provider ${providerId} is not allowlisted`);
		}
	}
	if (!allowlistedProviders.has(allowlist.defaultProviderId)) {
		throw new Error(`Default provider ${allowlist.defaultProviderId} is not allowlisted`);
	}
}

export async function loadValidatedConfiguration() {
	const [catalog, catalogSchema, allowlist, allowlistSchema] = await Promise.all([
		readJson(catalogPath),
		readJson(catalogSchemaPath),
		readJson(allowlistPath),
		readJson(allowlistSchemaPath),
	]);
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	assertSchema(ajv.compile(catalogSchema), catalog, "Model catalog");
	assertSchema(ajv.compile(allowlistSchema), allowlist, "Provider allowlist");
	validateCrossConstraints(catalog, allowlist);
	return { catalog, allowlist };
}

async function main() {
	const { catalog, allowlist } = await loadValidatedConfiguration();
	const modelCount = catalog.providers.reduce((total, provider) => total + provider.models.length, 0);
	console.log(`Validated ${allowlist.providers.length} providers and ${modelCount} models.`);
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
	await main();
}

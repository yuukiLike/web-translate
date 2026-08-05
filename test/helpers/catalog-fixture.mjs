import { readFile } from "node:fs/promises";

const applicationRoot = new URL("../../", import.meta.url);

async function readJson(relativePath) {
	return JSON.parse(await readFile(new URL(relativePath, applicationRoot), "utf8"));
}

export async function createCatalogFixture() {
	const [snapshot, allowlist] = await Promise.all([
		readJson("data/models-dev-subset.json"),
		readJson("config/provider-allowlist.json"),
	]);
	const providerById = new Map(snapshot.providers.map((provider) => [provider.id, provider]));
	return {
		schemaVersion: snapshot.schemaVersion,
		source: snapshot.source,
		defaultProviderId: allowlist.defaultProviderId,
		providers: Object.fromEntries(
			allowlist.providers.map((allowedProvider) => {
				const provider = providerById.get(allowedProvider.id);
				return [
					allowedProvider.id,
					{
						...allowedProvider,
						name: provider.name,
						models: Object.fromEntries(provider.models.map((model) => [model.id, model])),
					},
				];
			}),
		),
	};
}

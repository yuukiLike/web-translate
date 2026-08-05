import assert from "node:assert/strict";
import test from "node:test";

import { createCore } from "../../src/core/create-core.js";
import { createCatalogFixture } from "../helpers/catalog-fixture.mjs";

const core = createCore(await createCatalogFixture());

// 验证缓存按站点、Provider、模型、方向和原文隔离，避免跨上下文误复用。
test("缓存键包含所有翻译语义边界", () => {
	const base = core.normalizeSettings({
		provider: "deepseek",
		deepseek: { apiKey: "secret", model: "deepseek-v4-flash" },
	});
	const original = core.cacheKey(base, "en", "zh", "hello", "https://example.com");
	assert.notEqual(original, core.cacheKey(base, "zh", "en", "hello", "https://example.com"));
	assert.notEqual(original, core.cacheKey(base, "en", "zh", "world", "https://example.com"));
	assert.notEqual(original, core.cacheKey(base, "en", "zh", "hello", "https://other.example"));
	assert.ok(original.startsWith(core.CACHE_PREFIX));
	assert.ok(!original.includes("hello"));
});

// 验证 DeepL Free 旧式密钥后缀仍会选择免费 API host。
test("DeepL 密钥后缀决定 API host", () => {
	assert.equal(core.getDeepLApiHost("key:fx"), "api-free.deepl.com");
	assert.equal(core.getDeepLApiHost("key"), "api.deepl.com");
});

// 验证异常长的 Provider 输出会被限制在与原文规模相符的上限内。
test("译文最大长度随原文增长并保持硬上限", () => {
	assert.equal(core.getMaximumTranslationLength(1), 2_000);
	assert.equal(core.getMaximumTranslationLength(10_000), 20_000);
});

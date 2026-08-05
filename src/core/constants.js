export const CACHE_INDEX_KEY = "translation-cache-index";
export const CACHE_PREFIX = "translation-cache:";
export const SETTINGS_KEY = "settings";
export const USAGE_KEY = "usage";

export const CHAT_TRANSLATION_PROTOCOL_VERSION = "ai-sdk-json-v2";
export const MAXIMUM_API_KEY_LENGTH = 4_096;
export const MAXIMUM_CUSTOM_BASE_URL_LENGTH = 2_048;

export const MODEL_PROVIDER_IDS = Object.freeze([
	"deepseek",
	"openai",
	"google",
	"anthropic",
]);

export const TARGET_MODES = new Set(["auto", "zh", "en"]);

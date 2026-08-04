import { getPreferenceValues } from "@raycast/api";

import { normalizePreferences } from "./core.ts";
import type { TranslationPreferences } from "./types.ts";

interface RaycastPreferences {
	provider: string;
	targetLanguage: string;
	deepseekApiKey?: string;
	openaiApiKey?: string;
	googleApiKey?: string;
	anthropicApiKey?: string;
	azureApiKey?: string;
	azureRegion?: string;
	deeplApiKey?: string;
	cacheEnabled?: boolean;
	debugMode?: boolean;
}

export function getValidatedPreferences(): TranslationPreferences {
	return normalizePreferences(getPreferenceValues<RaycastPreferences>());
}

import { Clipboard, showHUD } from "@raycast/api";

import { translateText } from "./lib/index";
import { readSelectionOrClipboard } from "./read-input";

export async function runQuickTranslation(action: "copy" | "paste"): Promise<void> {
	try {
		await showHUD("Translating…");
		const input = await readSelectionOrClipboard();
		const result = await translateText(input.text);

		if (action === "copy") {
			await Clipboard.copy(result.translatedText);
			await showHUD(result.cached ? "Translation copied (cache hit)" : "Translation copied");
			return;
		}

		await Clipboard.paste(result.translatedText);
		await showHUD(result.cached ? "Translation pasted (cache hit)" : "Translation pasted");
	} catch (error: unknown) {
		await showHUD(quickErrorMessage(error));
	}
}

function quickErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message.slice(0, 160);
	}
	return "Translation failed. Check the provider and API key in extension preferences.";
}

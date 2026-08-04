import { Clipboard, getSelectedText } from "@raycast/api";

export type InputSource = "clipboard" | "manual" | "selection";

export interface TextInput {
	text: string;
	source: Exclude<InputSource, "manual">;
}

export async function readSelectionOrClipboard(): Promise<TextInput> {
	try {
		const selectedText = await getSelectedText();
		if (selectedText.trim()) {
			return { text: selectedText, source: "selection" };
		}
	} catch {
		// Raycast rejects when the frontmost application has no readable selection.
	}

	const clipboardText = await Clipboard.readText();
	if (clipboardText?.trim()) {
		return { text: clipboardText, source: "clipboard" };
	}

	throw new Error("Select text or copy text to the clipboard, then run the command again.");
}

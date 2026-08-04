import type { InputSource } from "./read-input";

export function languageName(language: "en" | "zh"): string {
	return language === "zh" ? "简体中文" : "English";
}

export function inputSourceName(source: InputSource): string {
	switch (source) {
		case "clipboard":
			return "Clipboard";
		case "manual":
			return "Manual Input";
		case "selection":
			return "Selected Text";
	}
}

export function markdownText(value: string): string {
	return value
		.split("\n")
		.map((line) => `&#8203;${escapeMarkdownLine(line)}`)
		.join("\n");
}

function escapeMarkdownLine(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replace(/[\\`*_{}[\]()<>#+\-.!|~]/gu, (character) => `&#${character.codePointAt(0)};`);
}

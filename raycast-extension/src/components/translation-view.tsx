import {
	Action,
	ActionPanel,
	Detail,
	Icon,
	Toast,
	openExtensionPreferences,
	showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";

import { clearTranslationCache, translateText, type TranslationResult } from "../lib/index";
import { inputSourceName, languageName, markdownText } from "../presentation";
import type { InputSource } from "../read-input";

interface TranslationViewProps {
	inputSource: InputSource;
	sourceText: string;
}

interface TranslationState {
	error?: string;
	loading: boolean;
	result?: TranslationResult;
}

export function TranslationView({ inputSource, sourceText }: TranslationViewProps) {
	const [requestVersion, setRequestVersion] = useState(0);
	const [state, setState] = useState<TranslationState>({ loading: true });

	useEffect(() => {
		const controller = new AbortController();
		let active = true;
		setState({ loading: true });

		void translateText(sourceText, {
			bypassCache: requestVersion > 0,
			signal: controller.signal,
		}).then(
			(result) => {
				if (active) {
					setState({ loading: false, result });
				}
			},
			(error: unknown) => {
				if (active) {
					setState({ error: errorMessage(error), loading: false });
				}
			},
		);

		return () => {
			active = false;
			controller.abort();
		};
	}, [requestVersion, sourceText]);

	const retry = () => setRequestVersion((version) => version + 1);
	const actions = state.result ? (
		<SuccessfulTranslationActions result={state.result} retry={retry} />
	) : (
		<ActionPanel>
			<Action title="Retry Translation" icon={Icon.RotateClockwise} onAction={retry} />
			<Action
				title="Open Extension Preferences"
				icon={Icon.Gear}
				onAction={openExtensionPreferences}
			/>
			<Action.CopyToClipboard title="Copy Original Text" content={sourceText} />
		</ActionPanel>
	);

	return (
		<Detail
			actions={actions}
			isLoading={state.loading}
			markdown={translationMarkdown(sourceText, state)}
			metadata={
				state.result ? (
					<TranslationMetadata inputSource={inputSource} result={state.result} />
				) : undefined
			}
			navigationTitle="Bilingual Translation"
		/>
	);
}

function SuccessfulTranslationActions({
	result,
	retry,
}: {
	result: TranslationResult;
	retry: () => void;
}) {
	return (
		<ActionPanel>
			<ActionPanel.Section>
				<Action.CopyToClipboard title="Copy Translation" content={result.translatedText} />
				<Action.Paste title="Paste Translation" content={result.translatedText} />
				<Action.CopyToClipboard
					title="Copy Bilingual Text"
					content={`${result.sourceText}\n\n${result.translatedText}`}
				/>
			</ActionPanel.Section>
			<ActionPanel.Section>
				<Action title="Translate Again" icon={Icon.RotateClockwise} onAction={retry} />
				<Action
					title="Clear Translation Cache"
					icon={Icon.Trash}
					onAction={async () => {
						clearTranslationCache();
						await showToast({
							style: Toast.Style.Success,
							title: "Translation cache cleared",
						});
					}}
				/>
				<Action
					title="Open Extension Preferences"
					icon={Icon.Gear}
					onAction={openExtensionPreferences}
				/>
			</ActionPanel.Section>
		</ActionPanel>
	);
}

function TranslationMetadata({
	inputSource,
	result,
}: {
	inputSource: InputSource;
	result: TranslationResult;
}) {
	return (
		<Detail.Metadata>
			<Detail.Metadata.Label title="Provider" text={providerName(result.provider)} />
			<Detail.Metadata.Label title="Model" text={result.modelId ?? "Dedicated Translation API"} />
			<Detail.Metadata.Label
				title="Direction"
				text={`${languageName(result.sourceLanguage)} → ${languageName(result.targetLanguage)}`}
			/>
			<Detail.Metadata.Label title="Input" text={inputSourceName(inputSource)} />
			<Detail.Metadata.Label title="Cache" text={result.cached ? "Hit" : "Miss"} />
			<Detail.Metadata.Label title="Elapsed" text={`${result.elapsedMs} ms`} />
			{result.usage.inputTokens !== undefined ? (
				<Detail.Metadata.Label
					title="Input Tokens"
					text={result.usage.inputTokens.toLocaleString("en-US")}
				/>
			) : null}
			{result.usage.outputTokens !== undefined ? (
				<Detail.Metadata.Label
					title="Output Tokens"
					text={result.usage.outputTokens.toLocaleString("en-US")}
				/>
			) : null}
			{result.usage.cacheReadTokens !== undefined ? (
				<Detail.Metadata.Label
					title="Cache Read Tokens"
					text={result.usage.cacheReadTokens.toLocaleString("en-US")}
				/>
			) : null}
			{result.usage.billedCharacters !== undefined ? (
				<Detail.Metadata.Label
					title="Billed Characters"
					text={result.usage.billedCharacters.toLocaleString("en-US")}
				/>
			) : null}
		</Detail.Metadata>
	);
}

function translationMarkdown(sourceText: string, state: TranslationState): string {
	if (state.error) {
		return `# Translation Unavailable\n\n${markdownText(state.error)}\n\n---\n\n${markdownText(sourceText)}`;
	}

	if (!state.result) {
		return `# Translating…\n\n${markdownText(sourceText)}`;
	}

	return `## ${languageName(state.result.sourceLanguage)}\n\n${markdownText(state.result.sourceText)}\n\n---\n\n## ${languageName(state.result.targetLanguage)}\n\n${markdownText(state.result.translatedText)}`;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message.slice(0, 500);
	}
	return "Translation failed. Check the selected provider and API key, then try again.";
}

function providerName(provider: TranslationResult["provider"]): string {
	switch (provider) {
		case "anthropic":
			return "Anthropic";
		case "azure":
			return "Azure Translator";
		case "deepl":
			return "DeepL";
		case "deepseek":
			return "DeepSeek";
		case "google":
			return "Google Gemini";
		case "openai":
			return "OpenAI";
	}
}

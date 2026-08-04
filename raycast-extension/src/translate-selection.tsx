import { Action, ActionPanel, Detail, Icon, openExtensionPreferences } from "@raycast/api";
import { useEffect, useState } from "react";

import { TranslationView } from "./components/translation-view";
import { markdownText } from "./presentation";
import { readSelectionOrClipboard, type TextInput } from "./read-input";

interface InputState {
	error?: string;
	input?: TextInput;
	loading: boolean;
}

export default function TranslateSelectionCommand() {
	const [requestVersion, setRequestVersion] = useState(0);
	const [state, setState] = useState<InputState>({ loading: true });

	useEffect(() => {
		let active = true;
		setState({ loading: true });
		void readSelectionOrClipboard().then(
			(input) => {
				if (active) {
					setState({ input, loading: false });
				}
			},
			(error: unknown) => {
				if (active) {
					setState({ error: inputErrorMessage(error), loading: false });
				}
			},
		);
		return () => {
			active = false;
		};
	}, [requestVersion]);

	if (state.input) {
		return <TranslationView inputSource={state.input.source} sourceText={state.input.text} />;
	}

	return (
		<Detail
			actions={
				<ActionPanel>
					<Action
						title="Read Selection Again"
						icon={Icon.RotateClockwise}
						onAction={() => setRequestVersion((version) => version + 1)}
					/>
					<Action
						title="Open Extension Preferences"
						icon={Icon.Gear}
						onAction={openExtensionPreferences}
					/>
				</ActionPanel>
			}
			isLoading={state.loading}
			markdown={
				state.error ? `# No Text Found\n\n${markdownText(state.error)}` : "# Reading Selected Text…"
			}
			navigationTitle="Translate Selection"
		/>
	);
}

function inputErrorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Select text or copy text to the clipboard, then run the command again.";
}

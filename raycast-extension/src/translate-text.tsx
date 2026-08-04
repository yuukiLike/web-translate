import {
	Action,
	ActionPanel,
	Clipboard,
	Form,
	Icon,
	Toast,
	openExtensionPreferences,
	showToast,
	useNavigation,
} from "@raycast/api";
import { useState } from "react";

import { TranslationView } from "./components/translation-view";

interface TranslateFormValues extends Form.Values {
	text: string;
}

export default function TranslateTextCommand() {
	const { push } = useNavigation();
	const [text, setText] = useState("");

	return (
		<Form
			actions={
				<ActionPanel>
					<Action.SubmitForm<TranslateFormValues>
						title="Translate"
						icon={Icon.Document}
						onSubmit={async (values) => {
							if (!values.text.trim()) {
								await showToast({
									style: Toast.Style.Failure,
									title: "Enter text to translate",
								});
								return false;
							}

							push(<TranslationView inputSource="manual" sourceText={values.text} />);
						}}
					/>
					<Action
						title="Use Clipboard Text"
						icon={Icon.Clipboard}
						onAction={async () => {
							const clipboardText = await Clipboard.readText();
							if (clipboardText?.trim()) {
								setText(clipboardText);
								return;
							}
							await showToast({
								style: Toast.Style.Failure,
								title: "Clipboard has no text",
							});
						}}
					/>
					<Action
						title="Open Extension Preferences"
						icon={Icon.Gear}
						onAction={openExtensionPreferences}
					/>
				</ActionPanel>
			}
			navigationTitle="Translate Text"
		>
			<Form.TextArea
				id="text"
				title="Text"
				placeholder="Enter English or Chinese text"
				autoFocus
				value={text}
				onChange={setText}
			/>
		</Form>
	);
}

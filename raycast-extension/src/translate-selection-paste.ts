import { runQuickTranslation } from "./quick-translation";

export default async function TranslateSelectionAndPasteCommand(): Promise<void> {
	await runQuickTranslation("paste");
}

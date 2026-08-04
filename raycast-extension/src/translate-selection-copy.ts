import { runQuickTranslation } from "./quick-translation";

export default async function TranslateSelectionAndCopyCommand(): Promise<void> {
	await runQuickTranslation("copy");
}

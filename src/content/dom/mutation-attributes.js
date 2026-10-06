import { findSiteProfileMutationRoot } from "../site-profile.js";
import { isOwnedNode } from "./node-utils.js";

/** 监听属性与它们触发的恢复/排除规则，集中供 MutationMonitor 使用。 */
export const GENERATED_ATTRIBUTES = new Set([
	"aria-describedby",
	"data-bt-description-id",
	"data-bt-generated-owned",
	"data-bt-owned",
	"data-bt-presentation",
	"data-bt-presentation-run",
	"data-bt-run",
	"data-bt-source",
	"data-bt-translation",
	"data-bt-translation-lang",
	"id",
]);
export const EXCLUSION_ATTRIBUTES = new Set(["aria-hidden", "inert", "translate", "contenteditable"]);

const OBSERVED_ATTRIBUTES = [
	...GENERATED_ATTRIBUTES,
	"aria-hidden",
	"aria-label",
	"class",
	"contenteditable",
	"data-hovercard-type",
	"hidden",
	"href",
	"inert",
	"lang",
	"open",
	"role",
	"style",
	"translate",
];

export function getObservedAttributes() {
	return OBSERVED_ATTRIBUTES;
}

/** 按属性变化失效最小正文块，链接地址变化直接复用已有翻译缓存。 */
export function handleAttributeMutation(monitor, mutation) {
	const { elementStore, scanner, invalidator, scanQueue, visibilityMonitor, generatedReconciler } = monitor;
	if (isOwnedNode(mutation.target)) return false;
	if (GENERATED_ATTRIBUTES.has(mutation.attributeName)) {
		generatedReconciler.restoreAttributes(mutation.target);
		return false;
	}
	const siteMutationRoot = findSiteProfileMutationRoot(mutation);
	if (mutation.attributeName === "class" || mutation.attributeName === "style") {
		visibilityMonitor.queue(mutation.target);
		visibilityMonitor.schedule();
		if (!siteMutationRoot) return false;
	}
	if (siteMutationRoot) {
		const trackedSource = elementStore.findTrackedAncestor(siteMutationRoot);
		invalidator.invalidateTrackedSubtree(siteMutationRoot, true);
		scanQueue.add(trackedSource ?? siteMutationRoot);
		return true;
	}
	if (mutation.attributeName === "href") {
		const source = elementStore.findTrackedAncestor(mutation.target);
		const candidate = source && scanner.currentCandidate(source);
		const translation = source && elementStore.getState(source)?.translationNode;
		if (!candidate?.inlineLinks.includes(mutation.target) && !translation?.querySelector("a.bt-translation-link")) {
			return false;
		}
		invalidator.invalidate(source);
		scanQueue.add(source);
		return true;
	}
	const trackedSource = elementStore.findTrackedAncestor(mutation.target);
	const scanRoot = trackedSource ?? scanner.findContentUnit(mutation.target) ?? mutation.target;
	if (EXCLUSION_ATTRIBUTES.has(mutation.attributeName)) {
		if (scanner.isExcluded(mutation.target)) invalidator.discardTrackedSubtree(mutation.target, true);
		else invalidator.invalidateTrackedSubtree(mutation.target, true);
		scanQueue.add(scanRoot);
		return true;
	}
	if (mutation.attributeName === "hidden" || mutation.attributeName === "role") {
		invalidator.invalidateTrackedSubtree(mutation.target, true, (source) => !generatedReconciler.queue(source));
	}
	scanQueue.add(scanRoot);
	return true;
}

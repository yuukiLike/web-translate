import { SITE_PRESENTATION } from "../site-profile.js";

const GENERATED_SOURCE_SELECTOR = [
	"[data-bt-generated-owned='true']",
	"[data-bt-presentation='generated'][data-bt-presentation-run][data-bt-description-id]",
].join(", ");
const GENERATED_DATASET_NAMES = [
	"btSource",
	"btGeneratedOwned",
	"btPresentation",
	"btPresentationRun",
	"btTranslation",
	"btTranslationLang",
	"btDescriptionId",
];

let descriptionSequence = 0;

/** 创建不进入宿主布局子树的描述节点，并把可见文本声明在 source 属性上。 */
export function createGeneratedTranslation({ source, text, language, runId }) {
	const description = document.createElement("span");
	description.id = nextDescriptionId(document, runId);
	description.className = "bt-translation bt-translation-description";
	description.dataset.btOwned = "true";
	description.dataset.btRun = runId;
	description.lang = language;
	description.setAttribute("translate", "no");
	description.textContent = text;
	document.body.append(description);
	restoreGeneratedPresentation(source, description, runId);
	return description;
}

/** 宿主清理扩展属性时，在下一次绘制前用已跟踪描述恢复完整呈现。 */
export function restoreGeneratedPresentation(source, description, runId) {
	if (!source?.isConnected || !description?.isConnected) {
		return false;
	}
	const descriptionRun = description.dataset.btRun;
	if (!descriptionRun || descriptionRun !== runId) {
		return false;
	}
	source.dataset.btSource = runId;
	source.dataset.btGeneratedOwned = "true";
	source.dataset.btPresentation = SITE_PRESENTATION.generated;
	source.dataset.btPresentationRun = runId;
	source.dataset.btTranslation = description.textContent ?? "";
	source.dataset.btTranslationLang = description.lang;
	source.dataset.btDescriptionId = description.id;
	addDescriptionReference(source, description.id);
	return true;
}

export function isGeneratedPresentationIntact(source, description, runId) {
	if (
		!source?.isConnected ||
		!description?.isConnected ||
		source.dataset.btSource !== runId ||
		source.dataset.btGeneratedOwned !== "true" ||
		source.dataset.btPresentation !== SITE_PRESENTATION.generated ||
		source.dataset.btPresentationRun !== runId ||
		source.dataset.btDescriptionId !== description.id ||
		description.dataset.btRun !== runId ||
		source.dataset.btTranslation !== (description.textContent ?? "") ||
		source.dataset.btTranslationLang !== description.lang
	) {
		return false;
	}
	return getDescriptionReferences(source).includes(description.id);
}

/** ElementStore 已确认归属后，把 generated surface 原子迁移到同文新节点。 */
export function transferTrackedGeneratedPresentation(source, target, description, runId) {
	if (
		!target?.isConnected ||
		!isOwnedDescription(description, runId) ||
		!restoreGeneratedPresentation(target, description, runId)
	) {
		return false;
	}
	clearGeneratedSourceAttributes(source, description.id);
	return true;
}

/** 幂等清理一个 source 的 generated 属性、aria 引用和离屏描述。 */
export function clearGeneratedPresentation(
	source,
	{ runId = null, descriptionId = null } = {},
) {
	if (!source?.dataset) {
		return false;
	}
	if (
		runId &&
		source.dataset.btPresentationRun !== runId &&
		source.dataset.btSource !== runId
	) {
		return false;
	}
	const currentDescriptionId = source.dataset.btDescriptionId;
	if (descriptionId && currentDescriptionId && currentDescriptionId !== descriptionId) {
		return false;
	}
	const ownedDescriptionId = currentDescriptionId || descriptionId;
	clearGeneratedSourceAttributes(source, ownedDescriptionId);
	const description = ownedDescriptionId
		? source.ownerDocument?.getElementById(ownedDescriptionId)
		: null;
	if (description?.matches(".bt-translation-description[data-bt-owned='true']")) {
		description.remove();
	}
	return Boolean(ownedDescriptionId);
}

function isOwnedDescription(description, runId) {
	return Boolean(
		description?.isConnected &&
			description.dataset.btRun === runId &&
			description.matches(".bt-translation-description[data-bt-owned='true']"),
	);
}

function clearGeneratedSourceAttributes(source, descriptionId) {
	if (descriptionId) {
		removeDescriptionReference(source, descriptionId);
	}
	for (const name of GENERATED_DATASET_NAMES) {
		delete source.dataset[name];
	}
}

/** 新运行或停止运行时按 source 显式清理，不依赖旧脚本上下文中的实例方法。 */
export function cleanupGeneratedPresentations(root = document, runId = null) {
	const sources = [];
	if (root.matches?.(GENERATED_SOURCE_SELECTOR)) {
		sources.push(root);
	}
	sources.push(...(root.querySelectorAll?.(GENERATED_SOURCE_SELECTOR) ?? []));
	for (const source of sources) {
		if (isOwnedGeneratedSource(source)) {
			clearGeneratedPresentation(source, { runId });
		}
	}
}

function isOwnedGeneratedSource(source) {
	if (source.dataset.btGeneratedOwned === "true") {
		return true;
	}
	const descriptionId = source.dataset.btDescriptionId;
	const presentationRun = source.dataset.btPresentationRun;
	const description = descriptionId
		? source.ownerDocument?.getElementById(descriptionId)
		: null;
	return Boolean(
		source.dataset.btPresentation === SITE_PRESENTATION.generated &&
			presentationRun &&
			description?.matches(".bt-translation-description[data-bt-owned='true']") &&
			description.dataset.btRun === presentationRun,
	);
}

function nextDescriptionId(documentRef, runId) {
	let id;
	do {
		descriptionSequence += 1;
		id = `bt-translation-description-${runId}-${descriptionSequence}`;
	} while (documentRef.getElementById(id));
	return id;
}

function addDescriptionReference(source, descriptionId) {
	const references = new Set(getDescriptionReferences(source));
	references.add(descriptionId);
	source.setAttribute("aria-describedby", [...references].join(" "));
}

function removeDescriptionReference(source, descriptionId) {
	const references = getDescriptionReferences(source).filter(
		(value) => value !== descriptionId,
	);
	if (references.length > 0) {
		source.setAttribute("aria-describedby", references.join(" "));
	} else {
		source.removeAttribute("aria-describedby");
	}
}

function getDescriptionReferences(source) {
	return (source.getAttribute("aria-describedby") ?? "")
		.split(/\s+/u)
		.filter(Boolean);
}

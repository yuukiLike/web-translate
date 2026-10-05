import { SELECTORS } from "../constants.js";
import { createSiteProfile } from "../site-profile.js";
import { closestComposed, composedParent, containsComposed, isTranslationExcluded, textParent } from "./node-utils.js";
import { readableNodes } from "./text-walker.js";

/**
 * 把任意 DOM 根节点转换成“正文候选块”。
 * 这里只识别和序列化文本，不决定是否翻译，也不改写 DOM。
 */
export class DomScanner {
	constructor({ core, elementStore, layout, volatilityTracker }) {
		this.core = core;
		this.elementStore = elementStore;
		this.layout = layout;
		this.volatilityTracker = volatilityTracker;
		this.siteProfile = createSiteProfile(window.location);
	}

	collect(roots) {
		if (!document.body || roots.length === 0) {
			return [];
		}
		const { drafts, assignedOwners } = this.#assignTextNodes(roots);
		// 变更根可能只是段落中的一个 span；始终提交完整语义块。
		const incomplete = [...drafts.keys()].filter((element) => !roots.some((root) => containsComposed(root, element)));
		if (incomplete.length) {
			const expanded = [...new Set([...roots, ...incomplete])];
			return this.collect(expanded.filter((root) => !expanded.some((other) => other !== root && containsComposed(other, root))));
		}
		this.#markPartialDrafts(drafts, assignedOwners);
		return this.#buildCandidates(drafts);
	}

	currentCandidate(element) {
		return this.collect([element]).find((item) => item.element === element) ?? null;
	}

	matchesCurrentCandidate(element, originalHash) {
		const candidate = this.currentCandidate(element);
		return Boolean(candidate && this.core.hashText(candidate.text) === originalHash);
	}

	isExcluded(element) {
		return Boolean(
			!element ||
				this.volatilityTracker.isVolatile(element) ||
				isTranslationExcluded(element) ||
				this.siteProfile.isExcluded(element),
		);
	}

	findContentUnit(element, styleCache = new WeakMap()) {
		if (this.isExcluded(element)) {
			return null;
		}
		const siteContentUnit = this.siteProfile.findContentUnit(element);
		if (siteContentUnit && !this.isExcluded(siteContentUnit)) {
			return siteContentUnit;
		}
		const atomic = closestComposed(element, SELECTORS.atomic);
		if (atomic && !this.isExcluded(atomic)) {
			return atomic;
		}
		const leaf = closestComposed(element, SELECTORS.leaf);
		if (leaf && !this.isExcluded(leaf)) {
			return leaf;
		}

		let lastEligible = element;
		for (let current = element; current; current = composedParent(current)) {
			if (this.isExcluded(current)) {
				return lastEligible;
			}
			lastEligible = current;
			if (
				current.matches(SELECTORS.interactive) ||
				current.matches(SELECTORS.structural) ||
				current.matches(SELECTORS.language) ||
				current === document.body ||
				current.matches(SELECTORS.root)
			) {
				return current;
			}
			const display = this.layout.getStyle(current, styleCache).display;
			if (!display.startsWith("inline") && display !== "contents") {
				return current;
			}
		}
		return lastEligible;
	}

	getPresentation(element) {
		if (element.shadowRoot) return null;
		return this.siteProfile.getPresentation(element);
	}

	#assignTextNodes(roots) {
		const drafts = new Map();
		const assignedOwners = new WeakMap();
		const parentCache = new WeakMap();
		const visibilityCache = new WeakMap();
		const styleCache = new WeakMap();
		const visited = new WeakSet();
		let traversalIndex = 0;

		for (const root of roots) {
			for (const node of readableNodes(root)) {
				if (visited.has(node)) continue;
				visited.add(node);
				traversalIndex += 1;
				if (node.nodeType !== Node.TEXT_NODE) continue;
				if (!(node.textContent ?? "")) {
					continue;
				}
				const parent = textParent(node);
				let candidate = parentCache.get(parent);
				if (candidate === undefined) {
					candidate = this.findContentUnit(parent, styleCache);
					parentCache.set(parent, candidate);
				}
				if (!candidate) {
					continue;
				}
				if (parent !== candidate) {
					if (!visibilityCache.has(parent)) visibilityCache.set(parent, this.layout.isEligible(parent));
					if (!visibilityCache.get(parent)) {
						if (/[\p{L}\p{N}]/u.test(node.textContent)) this.elementStore.deferredElements.add(parent);
						continue;
					}
					this.elementStore.deferredElements.delete(parent);
				}
				let draft = drafts.get(candidate);
				if (!draft) {
					draft = { element: candidate, nodes: [] };
					drafts.set(candidate, draft);
				}
				draft.nodes.push({
					node,
					text: preservesWhitespace(this.layout.getStyle(parent, styleCache))
						? node.textContent
						: node.textContent.replace(/\s+/gu, " "),
					order: traversalIndex,
					block: this.#findNearestBlockContainer(parent, candidate, styleCache),
				});
				assignedOwners.set(node, candidate);
				this.elementStore.rememberTextOwner(node, candidate);
			}
		}
		return { drafts, assignedOwners };
	}

	#markPartialDrafts(drafts, assignedOwners) {
		for (const draft of drafts.values()) {
			for (const entry of draft.nodes) {
				if (!/\S/u.test(entry.node.textContent ?? "")) {
					continue;
				}
				for (let ancestor = textParent(entry.node); ancestor; ancestor = composedParent(ancestor)) {
					const ancestorDraft = drafts.get(ancestor);
					if (ancestorDraft && assignedOwners.get(entry.node) !== ancestor) {
						ancestorDraft.partial = true;
					}
					if (ancestor === document.body) {
						break;
					}
				}
			}
		}
	}

	#buildCandidates(drafts) {
		return [...drafts.values()]
			.map((draft) => ({
				element: draft.element,
				partial: Boolean(draft.partial),
				textAnchor: draft.nodes.findLast((entry) => /\S/u.test(entry.node.textContent ?? ""))?.node,
				controlAnchor: findControlAnchor(draft),
				placementAnchor: findPlacementAnchor(draft),
				presentationAnchor: findPresentationAnchor(draft),
				text: this.#serializeAssignedText(draft.nodes),
				traits: {
					interactiveKind: getInteractiveKind(draft.element),
					metadataOnly: containsOnlyMetadata(draft, this.siteProfile),
				},
			}))
			.filter((candidate) => /[\p{L}\p{N}]/u.test(candidate.text));
	}

	#findNearestBlockContainer(element, candidate, styleCache) {
		for (let current = element; current && containsComposed(candidate, current); current = composedParent(current)) {
			const display = this.layout.getStyle(current, styleCache).display;
			if (!display.startsWith("inline") && display !== "contents") {
				return current;
			}
			if (current === candidate) {
				break;
			}
		}
		return candidate;
	}

	#serializeAssignedText(entries) {
		let output = "";
		let previous = null;
		for (const entry of entries) {
			const rawText = entry.text ?? entry.node.textContent ?? "";
			if (!rawText) {
				continue;
			}
			if (
				previous &&
				!output.endsWith("\n") &&
				(entry.order !== previous.order + 1 || entry.block !== previous.block)
			) {
				output = output.replace(/[^\S\n]+$/u, "") + "\n";
			}
			output += rawText;
			previous = entry;
		}
		return this.core.normalizeSourceText(output);
	}
}

function preservesWhitespace(style) {
	return String(style.whiteSpace).startsWith("pre") || style.whiteSpace === "break-spaces";
}

function containsOnlyMetadata({ element, nodes }, siteProfile) {
	const meaningfulEntries = nodes.filter(({ node }) =>
		/[\p{L}\p{N}]/u.test(node.textContent ?? ""),
	);
	return (
		meaningfulEntries.length > 0 &&
		meaningfulEntries.every(({ node }) => isMetadataEntry(node, element, siteProfile))
	);
}

function isMetadataEntry(node, candidate, siteProfile) {
	if (siteProfile.isMetadata(textParent(node))) {
		return true;
	}
	if (node.parentElement?.closest(SELECTORS.metadata)) {
		return true;
	}
	const author = node.parentElement?.closest("[itemprop~='author']");
	return Boolean(author && (author === candidate || candidate.contains(author)));
}

function getInteractiveKind(element) {
	if (element.matches("button, [role='button']")) {
		return "button";
	}
	if (element.matches("a, [role='link']")) {
		return "link";
	}
	return null;
}

/** 只把同一个控件拥有的文字识别为标签，不把正文末尾的链接当成整段控件。 */
function findControlAnchor({ nodes }) {
	let control = null;
	for (const { node } of nodes) {
		if (!/\S/u.test(node.textContent ?? "")) continue;
		const owner = closestComposed(textParent(node),
			"a[href], button, summary, label, [role='button'], [role='link'], [role='tab'], [role^='menuitem']");
		if (!owner || (control && control !== owner)) return null;
		control = owner;
	}
	return control;
}

function findPlacementAnchor(draft) {
	const lastEntry = draft.nodes.findLast((entry) => /\S/u.test(entry.node.textContent ?? ""));
	let anchor = lastEntry?.node ?? draft.element;
	while (composedParent(anchor) && composedParent(anchor) !== draft.element) {
		anchor = composedParent(anchor);
	}
	return anchor;
}

/**
 * Generated 译文跟随最后一段原文的原生承载节点；宿主替换 carrier 时，
 * reconciler 会按新的 candidate anchor 复挂。链接或控件内不安全时退到外层。
 */
function findPresentationAnchor(draft) {
	const lastEntry = draft.nodes.findLast((entry) => /\S/u.test(entry.node.textContent ?? ""));
	let anchor = lastEntry?.node.parentElement ?? draft.element;
	const interactive = anchor.closest?.(SELECTORS.interactive);
	if (interactive && draft.element.contains(interactive)) {
		anchor = interactive.parentElement;
	}
	return anchor && (anchor === draft.element || draft.element.contains(anchor))
		? anchor
		: draft.element;
}

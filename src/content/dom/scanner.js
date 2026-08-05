import { SELECTORS } from "../constants.js";

/**
 * 把任意 DOM 根节点转换成“正文候选块”。
 * 这里只识别和序列化文本，不决定是否翻译，也不改写 DOM。
 */
export class DomScanner {
	constructor({ core, elementStore, layout }) {
		this.core = core;
		this.elementStore = elementStore;
		this.layout = layout;
	}

	collect(roots) {
		if (!document.body || roots.length === 0) {
			return [];
		}
		const { drafts, assignedOwners } = this.#assignTextNodes(roots);
		this.#markPartialDrafts(drafts, assignedOwners);
		return this.#buildCandidates(drafts);
	}

	currentCandidate(element) {
		return this.collect([element]).find((item) => item.element === element) ?? null;
	}

	findContentUnit(element, styleCache = new WeakMap()) {
		if (!element || element.closest(SELECTORS.excluded)) {
			return null;
		}
		const atomic = element.closest(SELECTORS.atomic);
		if (atomic) {
			return atomic;
		}
		const leaf = element.closest(SELECTORS.leaf);
		if (leaf) {
			return leaf;
		}

		for (let current = element; current; current = current.parentElement) {
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
		return document.body;
	}

	#assignTextNodes(roots) {
		const drafts = new Map();
		const assignedOwners = new WeakMap();
		const parentCache = new WeakMap();
		const styleCache = new WeakMap();
		let traversalIndex = 0;

		for (const root of roots) {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				traversalIndex += 1;
				if (!(node.textContent ?? "")) {
					continue;
				}
				const parent = node.parentElement;
				let candidate = parentCache.get(parent);
				if (candidate === undefined) {
					candidate = this.findContentUnit(parent, styleCache);
					parentCache.set(parent, candidate);
				}
				if (!candidate) {
					continue;
				}
				let draft = drafts.get(candidate);
				if (!draft) {
					draft = { element: candidate, nodes: [] };
					drafts.set(candidate, draft);
				}
				draft.nodes.push({
					node,
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
				for (let ancestor = entry.node.parentElement; ancestor; ancestor = ancestor.parentElement) {
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
				placementAnchor: findPlacementAnchor(draft),
				text: this.#serializeAssignedText(draft.nodes),
			}))
			.filter((candidate) => /[\p{L}\p{N}]/u.test(candidate.text));
	}

	#findNearestBlockContainer(element, candidate, styleCache) {
		for (let current = element; current && candidate.contains(current); current = current.parentElement) {
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
			const rawText = entry.node.textContent ?? "";
			if (!rawText) {
				continue;
			}
			if (
				previous &&
				!/\s$/u.test(output) &&
				!/^\s/u.test(rawText) &&
				(entry.order !== previous.order + 1 || entry.block !== previous.block)
			) {
				output += "\n";
			}
			output += rawText;
			previous = entry;
		}
		return this.core.normalizeSourceText(output);
	}
}

function findPlacementAnchor(draft) {
	const lastEntry = draft.nodes.findLast((entry) => /\S/u.test(entry.node.textContent ?? ""));
	let anchor = lastEntry?.node ?? draft.element;
	while (anchor.parentElement && anchor.parentElement !== draft.element) {
		anchor = anchor.parentElement;
	}
	return anchor;
}

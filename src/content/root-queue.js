import { containsComposed, isOwnedNode } from "./dom/node-utils.js";

/** 合并嵌套 DOM 根节点，避免同一轮扫描重复遍历。 */
export class RootQueue {
	#roots = new Set();

	get size() {
		return this.#roots.size;
	}

	clear() {
		this.#roots.clear();
	}

	add(root) {
		const element = [Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root?.nodeType)
			? root
			: root?.parentElement ?? root?.getRootNode?.().host;
		if (!element?.isConnected || isOwnedNode(element)) {
			return;
		}

		for (const queued of this.#roots) {
			if (!queued.isConnected) {
				this.#roots.delete(queued);
				continue;
			}
			if (containsComposed(queued, element)) {
				return;
			}
			if (containsComposed(element, queued)) {
				this.#roots.delete(queued);
			}
		}
		this.#roots.add(element);
	}

	take() {
		const roots = [...this.#roots].filter((root) => root?.isConnected);
		this.#roots.clear();
		return roots.filter(
			(root, index) =>
				!roots.some(
					(other, otherIndex) =>
						otherIndex !== index && other !== root && containsComposed(other, root),
				),
		);
	}
}

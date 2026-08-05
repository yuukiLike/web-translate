import { isOwnedNode } from "./dom/node-utils.js";

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
		const element = root?.nodeType === Node.ELEMENT_NODE ? root : root?.parentElement;
		if (!element?.isConnected || isOwnedNode(element)) {
			return;
		}

		for (const queued of this.#roots) {
			if (queued === element || queued.contains(element)) {
				return;
			}
			if (element.contains(queued)) {
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
						otherIndex !== index && other !== root && other.contains?.(root),
				),
		);
	}
}

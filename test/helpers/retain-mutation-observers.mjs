import { PropertySymbol } from "happy-dom";

/**
 * Happy DOM 20.11.1 只用 WeakRef 保存内部投递函数，GC 会令存活的 observer 丢失事件。
 * 在 observe → disconnect 期间保留该函数，事件收集、过滤和投递仍由原实现负责。
 */
export function retainMutationObserverCallbacks(window) {
	const NativeMutationObserver = window.MutationObserver;
	window.MutationObserver = class extends NativeMutationObserver {
		#callbacks = new Set();

		observe(target, options) {
			const existing = new Set(target?.[PropertySymbol.mutationListeners] ?? []);
			super.observe(target, options);
			for (const listener of target[PropertySymbol.mutationListeners]) {
				if (existing.has(listener)) {
					continue;
				}
				const callback = listener.callback.deref();
				if (callback) {
					this.#callbacks.add(callback);
				}
			}
		}

		disconnect() {
			super.disconnect();
			this.#callbacks.clear();
		}
	};
}

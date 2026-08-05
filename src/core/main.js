import { createCore } from "./create-core.js";

if (!globalThis.BilingualTranslatorCore) {
	Object.defineProperty(globalThis, "BilingualTranslatorCore", {
		value: createCore(globalThis.BilingualTranslatorProviderCatalog),
		configurable: false,
		enumerable: false,
		writable: false,
	});
}

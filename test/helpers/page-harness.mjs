import assert from "node:assert/strict";

function restoreGlobalDescriptors(descriptors) {
	for (const [name, descriptor] of descriptors.toReversed()) {
		if (descriptor) {
			Object.defineProperty(globalThis, name, descriptor);
		} else {
			delete globalThis[name];
		}
	}
}

export function exposeGlobals(values) {
	const previousDescriptors = [];
	try {
		for (const [name, value] of Object.entries(values)) {
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
			Object.defineProperty(globalThis, name, {
				configurable: true,
				writable: true,
				value,
			});
			previousDescriptors.push([name, descriptor]);
		}
	} catch (error) {
		restoreGlobalDescriptors(previousDescriptors);
		throw error;
	}

	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		restoreGlobalDescriptors(previousDescriptors);
	};
}

export async function settle() {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await Promise.resolve();
}

export async function waitFor(predicate, message) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (predicate()) return;
		await settle();
	}
	assert.fail(message);
}

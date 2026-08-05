import { isRecord } from "./data.js";

const REQUIRED_CORE_FUNCTIONS = Object.freeze([
	"createDefaultSettings",
	"getMonthKey",
	"getProviderConfigurationError",
	"getProviderLabel",
	"normalizeSettings",
]);

export function getCoreError(core) {
	if (!isRecord(core)) {
		return "扩展核心模块未载入。请重新构建并重新加载扩展。";
	}
	for (const name of REQUIRED_CORE_FUNCTIONS) {
		if (typeof core[name] !== "function") {
			return "扩展核心模块不完整。请重新构建并重新加载扩展。";
		}
	}
	if (typeof core.SETTINGS_KEY !== "string" || !core.SETTINGS_KEY) {
		return "扩展核心模块不完整。请重新构建并重新加载扩展。";
	}
	return "";
}

export function getManifestVersion(runtime) {
	try {
		const manifest = runtime?.getManifest();
		if (isRecord(manifest) && typeof manifest.version === "string" && manifest.version) {
			return `v${manifest.version}`;
		}
	} catch {
		// 致命运行时错误会在别处展示；标题始终保留稳定的回退文本。
	}
	return "版本未知";
}

export function createRuntimeMessenger(runtime) {
	return async function sendMessage(message) {
		if (!runtime || typeof runtime.sendMessage !== "function") {
			throw new Error("Chrome 扩展后台不可用");
		}
		const response = await runtime.sendMessage(message);
		if (!isRecord(response) || response.ok !== true) {
			const responseError =
				isRecord(response) && typeof response.error === "string" ? response.error : "";
			throw new Error(responseError || "扩展后台无响应");
		}
		return response;
	};
}

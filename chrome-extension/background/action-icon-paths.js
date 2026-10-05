export const LOADING_ICON_STEPS = 12;
export const ACTION_ICON_SIZES = Object.freeze([16, 32]);

// 构建脚本和工具栏共用文件名，避免进度图标生成后没有被正确引用。
export function getActionIconPaths(loadingStep = null) {
	if (loadingStep !== null && (
		!Number.isInteger(loadingStep) || loadingStep < 0 || loadingStep >= LOADING_ICON_STEPS
	)) {
		throw new Error("Invalid toolbar loading step.");
	}
	const prefix = loadingStep === null ? "icon" : `icon-loading-${loadingStep}`;
	return Object.fromEntries(ACTION_ICON_SIZES.map((size) => [size, `assets/icons/${prefix}-${size}.png`]));
}

export function canCaptureContent(settings, incognito) {
	return (
		settings.provider === "deepseek" &&
		settings.debugLogging === true &&
		settings.debugRequestPayload === true &&
		incognito === false
	);
}

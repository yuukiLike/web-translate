const DEFAULT_TIMEOUT_MS = 5_000;

export async function sendRuntimeMessage(chrome, message, timeoutMs = DEFAULT_TIMEOUT_MS) {
	let timeoutId;
	try {
		const response = await Promise.race([
			chrome.runtime.sendMessage(message),
			new Promise((_, reject) => {
				timeoutId = setTimeout(
					() => reject(new Error("扩展后台响应超时")),
					timeoutMs,
				);
			}),
		]);
		if (response?.ok !== true) {
			throw new Error(response?.error || "扩展后台暂时无响应");
		}
		return response;
	} finally {
		clearTimeout(timeoutId);
	}
}

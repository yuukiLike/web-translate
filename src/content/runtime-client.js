/** Chrome runtime 消息的唯一出口，统一校验后台响应。 */
export class RuntimeClient {
	async send(message) {
		const response = await chrome.runtime.sendMessage(message);
		if (!response?.ok) {
			throw new Error(response?.error || "扩展后台无响应");
		}
		return response;
	}

	startRun(runId) {
		return this.send({ type: "START_RUN", runId });
	}

	cancelRun(runId) {
		return this.send({ type: "CANCEL_RUN", runId });
	}

	reportStatus(runId, state, details = {}) {
		return this.send({ type: "STATUS", state, runId, ...details });
	}

	translateBatch(runId, batch) {
		return this.send({
			type: "TRANSLATE_BATCH",
			runId,
			sourceLanguage: batch.sourceLanguage,
			targetLanguage: batch.targetLanguage,
			segments: batch.items.map(({ id, text }) => ({ id, text })),
		});
	}

	openOptions() {
		return this.send({ type: "OPEN_OPTIONS" });
	}
}

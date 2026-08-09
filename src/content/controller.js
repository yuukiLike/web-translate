import { CONTROLLER_KEY } from "./constants.js";
import { cleanupGeneratedPresentations } from "./dom/generated-presentation.js";
import { RuntimeClient } from "./runtime-client.js";
import { StatusView } from "./status-view.js";
import { TranslationRun } from "./translation-run.js";

/** 管理用户的开/关操作；一次只允许一个 TranslationRun。 */
class TranslationController {
	#toggleQueue = Promise.resolve();
	#currentRun = null;

	constructor(core) {
		this.core = core;
		this.runtime = new RuntimeClient();
		this.statusView = new StatusView();
	}

	toggle() {
		const task = this.#toggleQueue.then(() => this.#toggle(), () => this.#toggle());
		this.#toggleQueue = task.catch(() => {});
		return task;
	}

	async #toggle() {
		if (this.#currentRun?.active) {
			const run = this.#currentRun;
			await run.stop();
			if (this.#currentRun === run) {
				this.#currentRun = null;
			}
			return;
		}
		void this.#start();
	}

	async #start() {
		cleanupStaleArtifacts();
		const run = new TranslationRun({
			runId: createRunId(),
			core: this.core,
			runtime: this.runtime,
			statusView: this.statusView,
		});
		this.#currentRun = run;
		this.statusView.show("正在分析当前网页…");
		try {
			const response = await this.runtime.startRun(run.runId);
			if (!run.active || this.#currentRun !== run) {
				return;
			}
			await run.start(response.settings);
		} catch (error) {
			if (run.active && this.#currentRun === run) {
				run.handleError(error);
			}
		}
	}
}

export function installController(core) {
	const existingController = globalThis[CONTROLLER_KEY];
	if (existingController) {
		void existingController.toggle();
		return;
	}
	const implementation = new TranslationController(core);
	const controller = Object.freeze({
		toggle: () => implementation.toggle(),
	});
	Object.defineProperty(globalThis, CONTROLLER_KEY, {
		value: controller,
		configurable: false,
		enumerable: false,
		writable: false,
	});
	void controller.toggle();
}

function cleanupStaleArtifacts() {
	cleanupGeneratedPresentations(document);
	for (const node of document.querySelectorAll(
		".bt-translation[data-bt-owned='true'], .bt-status[data-bt-owned='true']",
	)) {
		node.remove();
	}
	for (const element of document.querySelectorAll("[data-bt-source]")) {
		delete element.dataset.btSource;
	}
}

function createRunId() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

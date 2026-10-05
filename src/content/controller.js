import { CONTROLLER_KEY } from "./constants.js";
import { cleanupGeneratedPresentations } from "./dom/generated-presentation.js";
import { openRoots } from "./dom/node-utils.js";
import { RuntimeClient } from "./runtime-client.js";
import { StatusView } from "./status-view.js";
import { TranslationRun } from "./translation-run.js";
import { SelectionController } from "./selection/selection-controller.js";

/** 管理用户的开/关操作；一次只允许一个 TranslationRun。 */
class TranslationController {
	#toggleQueue = Promise.resolve();
	#currentRun = null;

	constructor(core) {
		this.core = core;
		this.runtime = new RuntimeClient();
		this.statusView = new StatusView();
		this.selection = new SelectionController({ core, runtime: this.runtime });
		this.settings = null;
	}

	getState() {
		return { active: Boolean(this.#currentRun?.active), selectionActive: this.selection.active };
	}

	execute(message) {
		const task = this.#toggleQueue.then(() => this.#execute(message));
		this.#toggleQueue = task.catch(() => {});
		return task;
	}

	async #execute(message) {
		const selectionWasEnabled = this.settings?.reading.selectionEnabled;
		if (message.settings) {
			this.settings = message.settings;
			const run = this.#currentRun;
			run?.renderer?.updateReading(this.settings.reading, run.pageRoots.roots);
		}
		if (message.command === "preferences") {
			if (selectionWasEnabled && !this.settings?.reading.selectionEnabled) this.selection.disable();
		} else if (message.command === "selection") {
			this.selection.close();
			this.selection.open(message.text, message.speakOnly === true);
		} else if (message.command === "sync") {
			if (message.selectionActive) this.selection.enable();
			else this.selection.disable();
			if (message.active && !this.#currentRun?.active) void this.#start();
			else if (!message.active && this.#currentRun?.active) await this.#toggle();
		} else {
			throw new Error("未知页面操作");
		}
		return this.getState();
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
			await run.start({ ...response.settings, reading: this.settings?.reading ?? response.settings.reading });
		} catch (error) {
			if (run.active && this.#currentRun === run) {
				run.handleError(error);
			}
		}
	}

	dispose() {
		this.selection.disable();
		void this.#currentRun?.stop();
	}
}

export function installController(core) {
	const existingController = globalThis[CONTROLLER_KEY];
	if (existingController) {
		return existingController;
	}
	cleanupStaleArtifacts(true);
	const implementation = new TranslationController(core);
	const controller = Object.freeze({
		toggle: () => implementation.toggle(),
		execute: (message) => implementation.execute(message),
		getState: () => implementation.getState(),
	});
	Object.defineProperty(globalThis, CONTROLLER_KEY, {
		value: controller,
		configurable: false,
		enumerable: false,
		writable: false,
	});
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (sender.id !== chrome.runtime.id) return false;
		if (message?.type === "BT_GET_PAGE_STATE") {
			sendResponse(controller.getState());
			return false;
		}
		if (message?.type === "BT_SPEECH_EVENT") {
			implementation.selection.onSpeechEvent(message);
			return false;
		}
		if (message?.type !== "BT_PAGE_COMMAND") return false;
		void controller.execute(message).then(
			(state) => sendResponse({ ok: true, ...state }),
			(error) => sendResponse({ ok: false, error: error.message }),
		);
		return true;
	});
	window.addEventListener("pagehide", () => implementation.dispose());
	return controller;
}

function cleanupStaleArtifacts(includeSelection = false) {
	const artifactSelector = [
		".bt-translation[data-bt-owned='true']",
		".bt-status[data-bt-owned='true']",
		...(includeSelection ? ["[data-bt-ui='selection'][data-bt-owned='true']"] : []),
	].join(", ");
	for (const root of [...openRoots(document)]) {
		cleanupGeneratedPresentations(root);
		for (const node of root.querySelectorAll(artifactSelector)) node.remove();
		for (const element of root.querySelectorAll("[data-bt-source], [data-bt-loading], [data-bt-reading-layout]")) {
			delete element.dataset.btReadingLayout;
			delete element.dataset.btLoading;
			delete element.dataset.btSource;
		}
	}
}

function createRunId() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

import { ElementStore } from "./element-store.js";
import { ProgressTracker } from "./progress-tracker.js";
import { RootQueue } from "./root-queue.js";
import { StatusReporter } from "./status-reporter.js";
import { RunTranslationCache } from "./translation/run-cache.js";
import { LayoutInspector } from "./dom/layout.js";
import { cleanupGeneratedPresentations } from "./dom/generated-presentation.js";
import { DomScanner } from "./dom/scanner.js";
import { ElementInvalidator } from "./dom/invalidation.js";
import { TranslationRenderer } from "./dom/renderer.js";
import { MutationMonitor } from "./dom/mutation-monitor.js";
import { VisibilityMonitor } from "./dom/visibility-monitor.js";
import { TranslationPlanner } from "./translation/planner.js";
import { CloudTranslator } from "./translation/cloud-translator.js";

/** 一次 start -> stop 的完整运行。依赖对象都限定在本次运行内。 */
export class TranslationRun {
	active = true;
	passRunning = false;
	rescanRequested = false;

	constructor({ runId, core, runtime, statusView }) {
		this.runId = runId;
		this.core = core;
		this.runtime = runtime;
		this.statusView = statusView;
		this.progress = new ProgressTracker();
		this.rootQueue = new RootQueue();
		this.runCache = new RunTranslationCache();
		this.statusReporter = new StatusReporter({
			runId,
			progress: this.progress,
			view: statusView,
			runtime,
			isCurrent: () => this.active,
			hasPendingWork: () => this.#hasPendingWork(),
		});
	}

	async start(settings) {
		if (!this.active) {
			return;
		}
		this.settings = settings;
		this.#createServices();
		this.rootQueue.add(document.body);
		if (settings.translateDynamicContent) {
			this.mutationMonitor.start();
		}
		await this.runTranslationPass();
	}

	async stop() {
		if (!this.active) {
			return;
		}
		this.active = false;
		this.mutationMonitor?.stop();
		removeRunArtifacts(this.runId);
		this.rootQueue.clear();
		this.elementStore?.deferredElements.clear();
		this.runCache.clear();
		this.statusView.remove();
		await Promise.allSettled([
			this.runtime.cancelRun(this.runId),
			this.runtime.reportStatus(this.runId, "off"),
		]);
	}

	async runTranslationPass() {
		if (!this.active) {
			return;
		}
		if (this.passRunning) {
			this.rescanRequested = true;
			return;
		}

		this.passRunning = true;
		let shouldRestart = false;
		try {
			do {
				this.rescanRequested = false;
				const segments = this.planner.collectSegments(this.rootQueue.take());
				const unresolved = this.cloudTranslator.resolveFromRunCache(segments);
				if (unresolved.length > 0) {
					await this.statusReporter.reportProgress();
					await this.cloudTranslator.translate(unresolved);
				}
			} while (this.active && (this.rescanRequested || this.rootQueue.size > 0));

			if (this.active) {
				await this.statusReporter.reportCompletion();
			}
		} finally {
			this.passRunning = false;
			shouldRestart = this.active && (this.rescanRequested || this.rootQueue.size > 0);
		}
		if (shouldRestart) {
			await this.runTranslationPass();
		}
	}

	handleError(error) {
		this.statusReporter.handleError(error);
	}

	#createServices() {
		this.elementStore = new ElementStore();
		this.layout = new LayoutInspector(this.elementStore);
		this.scanner = new DomScanner({
			core: this.core,
			elementStore: this.elementStore,
			layout: this.layout,
		});
		this.invalidator = new ElementInvalidator({
			elementStore: this.elementStore,
			progress: this.progress,
			rootQueue: this.rootQueue,
			getRunId: () => this.runId,
		});
		this.renderer = new TranslationRenderer({
			core: this.core,
			scanner: this.scanner,
			layout: this.layout,
			elementStore: this.elementStore,
			progress: this.progress,
			invalidator: this.invalidator,
			rootQueue: this.rootQueue,
			onNeedsRescan: () => this.mutationMonitor?.scheduleScan(),
		});
		this.planner = new TranslationPlanner({
			core: this.core,
			scanner: this.scanner,
			layout: this.layout,
			elementStore: this.elementStore,
			progress: this.progress,
			invalidator: this.invalidator,
			settings: this.settings,
			runId: this.runId,
		});
		this.#createMonitors();
		this.cloudTranslator = new CloudTranslator({
			core: this.core,
			settings: this.settings,
			runId: this.runId,
			runtime: this.runtime,
			rootQueue: this.rootQueue,
			planner: this.planner,
			runCache: this.runCache,
			renderer: this.renderer,
			elementStore: this.elementStore,
			invalidator: this.invalidator,
			isCurrent: () => this.active,
			reportProgress: () => this.statusReporter.reportProgress(),
		});
	}

	#createMonitors() {
		const monitorDependencies = {
			runId: this.runId,
			isCurrent: () => this.active,
			elementStore: this.elementStore,
			invalidator: this.invalidator,
			rootQueue: this.rootQueue,
			onScan: () => this.runTranslationPass(),
			onActivity: () => this.statusReporter.invalidatePendingCompletion(),
			onError: (error) => this.handleError(error),
		};
		this.visibilityMonitor = new VisibilityMonitor({
			...monitorDependencies,
			layout: this.layout,
			renderer: this.renderer,
		});
		this.mutationMonitor = new MutationMonitor({
			...monitorDependencies,
			scanner: this.scanner,
			visibilityMonitor: this.visibilityMonitor,
		});
	}

	#hasPendingWork() {
		return (
			this.rootQueue.size > 0 ||
			(this.visibilityMonitor?.size ?? 0) > 0 ||
			this.rescanRequested
		);
	}
}

function removeRunArtifacts(runId) {
	cleanupGeneratedPresentations(document, runId);
	for (const node of document.querySelectorAll(`[data-bt-run="${CSS.escape(runId)}"]`)) {
		node.remove();
	}
	for (const element of document.querySelectorAll(`[data-bt-source="${CSS.escape(runId)}"]`)) {
		delete element.dataset.btSource;
	}
}

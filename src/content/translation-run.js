import { ElementStore } from "./element-store.js";
import { ProgressTracker } from "./progress-tracker.js";
import { RootQueue } from "./root-queue.js";
import { StatusReporter } from "./status-reporter.js";
import { ContentVolatilityTracker } from "./volatile-content-tracker.js";
import { RunTranslationCache } from "./translation/run-cache.js";
import { LayoutInspector } from "./dom/layout.js";
import { PageRoots } from "./dom/page-roots.js";
import { cleanupGeneratedPresentations } from "./dom/generated-presentation.js";
import { DomScanner } from "./dom/scanner.js";
import { ElementInvalidator } from "./dom/invalidation.js";
import { TranslationRenderer } from "./dom/renderer.js";
import { MutationMonitor } from "./dom/mutation-monitor.js";
import { VisibilityMonitor } from "./dom/visibility-monitor.js";
import { DeferredContentMonitor } from "./dom/deferred-content-monitor.js";
import { TranslationPlanner } from "./translation/planner.js";
import { CloudTranslator } from "./translation/cloud-translator.js";
import { ContentTrace } from "./translation/content-trace.js";

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
			onRetry: () => {
				if (!this.planner) return this.runtime.openOptions();
				return this.runTranslationPass();
			},
		});
	}

	async start(settings) {
		if (!this.active) {
			return;
		}
		if (!document.body) {
			this.active = false;
			this.statusView.show("此文档没有可翻译的网页正文");
			await Promise.allSettled([
				this.runtime.cancelRun(this.runId),
				this.runtime.reportStatus(this.runId, "off"),
			]);
			return;
		}
		this.settings = settings;
		this.#createServices();
		this.deferredContent.start();
		if (settings.translateDynamicContent) {
			this.mutationMonitor.start();
		}
		this.pageRoots.start(settings.translateDynamicContent);
		await this.runTranslationPass();
	}

	async stop() {
		if (!this.active) {
			return;
		}
		this.active = false;
		this.deferredContent?.stop();
		this.mutationMonitor?.stop();
		this.cloudTranslator?.clearLoading();
		for (const root of this.pageRoots?.roots ?? [document]) removeRunArtifacts(root, this.runId);
		this.pageRoots?.stop();
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
		this.volatilityTracker = new ContentVolatilityTracker();
		this.layout = new LayoutInspector(this.elementStore);
		this.scanner = new DomScanner({
			core: this.core,
			elementStore: this.elementStore,
			layout: this.layout,
			volatilityTracker: this.volatilityTracker,
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
			reading: this.settings.reading,
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
		this.pageRoots = new PageRoots({
			onRoot: (root) => {
				this.rootQueue.add(root);
				this.mutationMonitor.observeRoot(root);
			},
			onRemoved: (root) => {
				this.mutationMonitor.removeRoot(root);
				this.invalidator.discardTrackedSubtree(root, false);
				if (root.host) this.invalidator.discard(root.host);
			},
			onActivity: (root) => this.mutationMonitor.scheduleScan(root),
		});
		this.cloudTranslator = new CloudTranslator({
			core: this.core,
			settings: this.settings,
			runId: this.runId,
			runtime: this.runtime,
			rootQueue: this.rootQueue,
			planner: this.planner,
			layout: this.layout,
			runCache: this.runCache,
			contentTrace: new ContentTrace({
				enabled: this.settings.captureContentTrace,
				runId: this.runId,
				runtime: this.runtime,
				runCache: this.runCache,
			}),
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
			progress: this.progress,
			rootQueue: this.rootQueue,
			onScan: () => this.runTranslationPass(),
			onActivity: () => this.statusReporter.invalidatePendingCompletion(),
			onError: (error) => this.handleError(error),
		};
		this.deferredContent = new DeferredContentMonitor({
			...monitorDependencies,
			layout: this.layout,
		});
		this.visibilityMonitor = new VisibilityMonitor({
			...monitorDependencies,
			deferredContent: this.deferredContent,
			layout: this.layout,
			renderer: this.renderer,
		});
		this.mutationMonitor = new MutationMonitor({
			...monitorDependencies,
			scanner: this.scanner,
			volatilityTracker: this.volatilityTracker,
			visibilityMonitor: this.visibilityMonitor,
		});
	}

	#hasPendingWork() {
		return (
			this.rootQueue.size > 0 ||
			this.mutationMonitor?.hasPendingWork ||
			this.visibilityMonitor?.hasBlockingWork ||
			this.rescanRequested
		);
	}
}

function removeRunArtifacts(root, runId) {
	cleanupGeneratedPresentations(root, runId);
	const escapedRunId = CSS.escape(runId);
	for (const node of root.querySelectorAll(`[data-bt-run="${escapedRunId}"]`)) {
		node.remove();
	}
	const sourceSelector = [
		`[data-bt-source="${escapedRunId}"]`,
		`[data-bt-loading="${escapedRunId}"]`,
	].join(", ");
	const sources = [...root.querySelectorAll(sourceSelector)];
	if (root.matches?.(sourceSelector)) sources.push(root);
	for (const element of sources) {
		delete element.dataset.btReadingLayout;
		delete element.dataset.btLoading;
		delete element.dataset.btSource;
	}
}

(() => {
	"use strict";

	const CONTROLLER_KEY = "__bilingualWebTranslatorController";
	const existingController = globalThis[CONTROLLER_KEY];
	if (existingController) {
		void existingController.toggle();
		return;
	}

	const core = globalThis.BilingualTranslatorCore;
	if (!core) {
		throw new Error("双语翻译核心未加载");
	}

	const ATOMIC_SELECTOR = "[data-testid='tweetText']";
	const STRUCTURAL_SELECTOR = "li, blockquote, figcaption, caption, td, th, dt, dd, summary";
	const LEAF_SELECTOR = "p, h1, h2, h3, h4, h5, h6";
	const LANGUAGE_SELECTOR = "[lang]:not(html):not(body)";
	const INTERACTIVE_SELECTOR = "a, button, input, textarea, select, option, [role='button'], [role='link']";
	const ROOT_SELECTOR = "main, article, [role='main']";
	const EXCLUDED_SELECTOR = [
		"script",
		"style",
		"noscript",
		"template",
		"svg",
		"canvas",
		"code",
		"pre",
		"kbd",
		"samp",
		"input",
		"textarea",
		"select",
		"option",
		"[contenteditable='true']",
		"[translate='no']",
		".bt-translation",
		".bt-status",
	].join(",");
	const state = {
		active: false,
		runId: "",
		settings: null,
		observer: null,
		mutationTimer: null,
		visibilityTimer: null,
		visibilityTargets: new Set(),
		deferredElements: new Set(),
		pendingRoots: new Set(),
		passRunning: false,
		passRunId: "",
		rescanRequested: false,
		elementStates: new WeakMap(),
		elementGenerations: new WeakMap(),
		layoutSignatures: new WeakMap(),
		textOwners: new WeakMap(),
		translationSources: new WeakMap(),
		statusNode: null,
		statusTimer: null,
		completed: 0,
		total: 0,
		segmentSequence: 0,
	};
	let toggleQueue = Promise.resolve();

	const controller = Object.freeze({
		toggle: enqueueToggle,
	});
	Object.defineProperty(globalThis, CONTROLLER_KEY, {
		value: controller,
		configurable: false,
		enumerable: false,
		writable: false,
	});
	void enqueueToggle();

	function enqueueToggle() {
		const task = toggleQueue.then(toggle, toggle);
		toggleQueue = task.catch(() => {});
		return task;
	}

	async function toggle() {
		if (state.active) {
			await stopTranslation();
			return;
		}
		void startTranslation();
	}

	function cleanupStaleArtifacts() {
		for (const node of document.querySelectorAll(
			".bt-translation[data-bt-owned='true'], .bt-status[data-bt-owned='true']",
		)) {
			node.remove();
		}
		for (const element of document.querySelectorAll("[data-bt-source]")) {
			delete element.dataset.btSource;
		}
	}

	async function startTranslation() {
		cleanupStaleArtifacts();
		state.active = true;
		state.runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
		const runId = state.runId;
		state.pendingRoots = new Set();
		state.visibilityTargets = new Set();
		state.deferredElements = new Set();
		state.elementStates = new WeakMap();
		state.elementGenerations = new WeakMap();
		state.layoutSignatures = new WeakMap();
		state.textOwners = new WeakMap();
		state.translationSources = new WeakMap();
		state.passRunning = false;
		state.passRunId = "";
		state.rescanRequested = false;
		state.completed = 0;
		state.total = 0;
		state.segmentSequence = 0;
		showStatus("正在分析当前网页…");

		try {
			const response = await sendMessage({ type: "START_RUN", runId });
			if (!isCurrentRun(runId)) {
				return;
			}
			state.settings = response.settings;
			queueRoot(document.body);
			if (state.settings.translateDynamicContent) {
				startMutationObserver(runId);
			}
			await runTranslationPass(runId);
		} catch (error) {
			if (isCurrentRun(runId)) {
				handleTranslationError(error);
			}
		}
	}

	function isCurrentRun(runId) {
		return state.active && state.runId === runId;
	}

	async function stopTranslation() {
		const oldRunId = state.runId;
		state.active = false;
		state.observer?.disconnect();
		state.observer = null;
		if (state.mutationTimer !== null) {
			clearTimeout(state.mutationTimer);
			state.mutationTimer = null;
		}
		if (state.visibilityTimer !== null) {
			clearTimeout(state.visibilityTimer);
			state.visibilityTimer = null;
		}
		if (state.statusTimer !== null) {
			clearTimeout(state.statusTimer);
			state.statusTimer = null;
		}
		for (const node of document.querySelectorAll(`[data-bt-run="${CSS.escape(oldRunId)}"]`)) {
			node.remove();
		}
		for (const element of document.querySelectorAll(`[data-bt-source="${CSS.escape(oldRunId)}"]`)) {
			delete element.dataset.btSource;
		}
		state.pendingRoots.clear();
		state.visibilityTargets.clear();
		state.deferredElements.clear();
		state.elementStates = new WeakMap();
		state.elementGenerations = new WeakMap();
		state.layoutSignatures = new WeakMap();
		state.textOwners = new WeakMap();
		state.translationSources = new WeakMap();
		state.statusNode?.remove();
		state.statusNode = null;
		await Promise.allSettled([
			sendMessage({ type: "CANCEL_RUN", runId: oldRunId }),
			sendMessage({ type: "STATUS", state: "off" }),
		]);
	}

	async function runTranslationPass(runId = state.runId) {
		if (!isCurrentRun(runId)) {
			return;
		}
		if (state.passRunning && state.passRunId === runId) {
			state.rescanRequested = true;
			return;
		}
		state.passRunning = true;
		state.passRunId = runId;
		let shouldRestart = false;
		try {
			do {
				state.rescanRequested = false;
				const segments = collectSegments(takePendingRoots());
				if (segments.length > 0) {
					await reportProgress(runId);
					await translateWithCloud(segments, runId);
				}
			} while (isCurrentRun(runId) && (state.rescanRequested || state.pendingRoots.size > 0));

			if (!isCurrentRun(runId)) {
				return;
			}
			if (state.total === 0) {
				showStatus("未找到需要翻译的中英文正文", {
					actionLabel: "打开设置",
					onAction: () => void sendMessage({ type: "OPEN_OPTIONS" }),
				});
				await sendMessage({ type: "STATUS", state: "off" });
			} else {
				showStatus(`双语翻译完成，已覆盖 ${state.completed}/${state.total} 个文本块`);
				await sendMessage({ type: "STATUS", state: "done" });
				state.statusTimer = setTimeout(() => {
					state.statusNode?.remove();
					state.statusNode = null;
				}, 2_800);
			}
		} finally {
			if (state.passRunId === runId) {
				state.passRunning = false;
				state.passRunId = "";
				shouldRestart =
					isCurrentRun(runId) &&
					(state.rescanRequested || state.pendingRoots.size > 0);
			}
		}
		if (shouldRestart) {
			await runTranslationPass(runId);
		}
	}

	function collectSegments(roots) {
		const records = collectCandidateElements(roots)
			.map((candidate) => createRecord(candidate))
			.filter(Boolean)
			.sort((left, right) => left.priority - right.priority);
		const uniqueSegments = new Map();

		for (const record of records) {
			record.element.dataset.btSource = state.runId;
			state.total += 1;
			const elementState = state.elementStates.get(record.element);
			elementState.counted = true;

			record.parts.forEach((text, partIndex) => {
				const dedupeKey = `${record.sourceLanguage}\u0000${record.targetLanguage}\u0000${text}`;
				let segment = uniqueSegments.get(dedupeKey);
				if (!segment) {
					state.segmentSequence += 1;
					segment = {
						id: `${state.runId}-${state.segmentSequence.toString(36)}`,
						text,
						priority: record.priority,
						sourceLanguage: record.sourceLanguage,
						targetLanguage: record.targetLanguage,
						targets: [],
					};
					uniqueSegments.set(dedupeKey, segment);
				} else {
					segment.priority = Math.min(segment.priority, record.priority);
				}
				segment.targets.push({ record, partIndex });
			});
		}

		return [...uniqueSegments.values()].sort((left, right) => left.priority - right.priority);
	}

	function takePendingRoots() {
		const roots = [...state.pendingRoots].filter((root) => root?.isConnected);
		state.pendingRoots.clear();
		return roots.filter(
			(root, index) =>
				!roots.some((other, otherIndex) => otherIndex !== index && other !== root && other.contains?.(root)),
		);
	}

	function queueRoot(root) {
		const element = root?.nodeType === Node.ELEMENT_NODE ? root : root?.parentElement;
		if (!element?.isConnected || isOwnedNode(element)) {
			return;
		}
		for (const queued of state.pendingRoots) {
			if (queued === element || queued.contains(element)) {
				return;
			}
			if (element.contains(queued)) {
				state.pendingRoots.delete(queued);
			}
		}
		state.pendingRoots.add(element);
	}

	function collectCandidateElements(roots) {
		if (!document.body || roots.length === 0) {
			return [];
		}
		const candidates = new Map();
		const owners = new WeakMap();
		const parentCache = new WeakMap();
		const styleCache = new WeakMap();
		let traversalIndex = 0;
		for (const root of roots) {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const rawText = node.textContent ?? "";
				traversalIndex += 1;
				if (!rawText) {
					continue;
				}
				const parent = node.parentElement;
				let candidate = parentCache.get(parent);
				if (candidate === undefined) {
					candidate = findContentUnit(parent, styleCache);
					parentCache.set(parent, candidate);
				}
				if (!candidate) {
					continue;
				}
				let draft = candidates.get(candidate);
				if (!draft) {
					draft = { element: candidate, nodes: [] };
					candidates.set(candidate, draft);
				}
				draft.nodes.push({
					node,
					order: traversalIndex,
					block: findNearestBlockContainer(parent, candidate, styleCache),
				});
				owners.set(node, candidate);
				state.textOwners.set(node, candidate);
			}
		}

		for (const draft of candidates.values()) {
			for (const entry of draft.nodes) {
				if (!/\S/u.test(entry.node.textContent ?? "")) {
					continue;
				}
				for (
					let ancestor = entry.node.parentElement;
					ancestor;
					ancestor = ancestor.parentElement
				) {
					const ancestorDraft = candidates.get(ancestor);
					if (ancestorDraft && owners.get(entry.node) !== ancestor) {
						ancestorDraft.partial = true;
					}
					if (ancestor === document.body) {
						break;
					}
				}
			}
		}

		return [...candidates.values()]
			.map((draft) => ({
				element: draft.element,
				partial: Boolean(draft.partial),
				placementAnchor: findPlacementAnchor(draft),
				text: serializeAssignedText(draft.nodes),
			}))
			.filter((candidate) => /[\p{L}\p{N}]/u.test(candidate.text));
	}

	function findPlacementAnchor(draft) {
		const lastEntry = draft.nodes.findLast((entry) => /\S/u.test(entry.node.textContent ?? ""));
		let anchor = lastEntry?.node ?? draft.element;
		while (anchor.parentElement && anchor.parentElement !== draft.element) {
			anchor = anchor.parentElement;
		}
		return anchor;
	}

	function findContentUnit(element, styleCache = new WeakMap()) {
		if (!element || element.closest(EXCLUDED_SELECTOR)) {
			return null;
		}
		const atomic = element.closest(ATOMIC_SELECTOR);
		if (atomic) {
			return atomic;
		}
		const leaf = element.closest(LEAF_SELECTOR);
		if (leaf) {
			return leaf;
		}
		for (let current = element; current; current = current.parentElement) {
			if (current.matches(INTERACTIVE_SELECTOR)) {
				return current;
			}
			if (current.matches(STRUCTURAL_SELECTOR) || current.matches(LANGUAGE_SELECTOR)) {
				return current;
			}
			if (current === document.body || current.matches(ROOT_SELECTOR)) {
				return current;
			}
			const display = getCachedStyle(current, styleCache).display;
			if (!display.startsWith("inline") && display !== "contents") {
				return current;
			}
		}
		return document.body;
	}

	function findNearestBlockContainer(element, candidate, styleCache) {
		for (let current = element; current && candidate.contains(current); current = current.parentElement) {
			const display = getCachedStyle(current, styleCache).display;
			if (!display.startsWith("inline") && display !== "contents") {
				return current;
			}
			if (current === candidate) {
				break;
			}
		}
		return candidate;
	}

	function getCachedStyle(element, cache) {
		let style = cache.get(element);
		if (!style) {
			style = getComputedStyle(element);
			cache.set(element, style);
			rememberLayoutSignature(element, style);
		}
		return style;
	}

	function rememberLayoutSignature(element, style) {
		if (!state.layoutSignatures.has(element)) {
			state.layoutSignatures.set(element, getLayoutSignature(style));
		}
	}

	function getLayoutSignature(style) {
		const display = String(style.display);
		if (display === "contents" || display.startsWith("inline")) {
			return display.startsWith("inline-flex")
				? `inline-flex:${String(style.flexDirection)}`
				: display.startsWith("inline-grid")
					? "inline-grid"
					: display === "contents"
						? "contents"
						: "inline";
		}
		if (display.includes("flex")) {
			return `flex:${String(style.flexDirection)}`;
		}
		return display.includes("grid") ? "grid" : "block";
	}

	function updateLayoutSignature(element, assumeChangedIfUnknown = false) {
		const signature = getLayoutSignature(getComputedStyle(element));
		const previous = state.layoutSignatures.get(element);
		state.layoutSignatures.set(element, signature);
		return previous === undefined ? assumeChangedIfUnknown : previous !== signature;
	}

	function serializeAssignedText(entries) {
		let output = "";
		let previous = null;
		for (const entry of entries) {
			const rawText = entry.node.textContent ?? "";
			if (!rawText) {
				continue;
			}
			if (
				previous &&
				!/\s$/u.test(output) &&
				!/^\s/u.test(rawText) &&
				(entry.order !== previous.order + 1 || entry.block !== previous.block)
			) {
				output += "\n";
			}
			output += rawText;
			previous = entry;
		}
		return core.normalizeSourceText(output);
	}

	function isEligibleElement(element) {
		if (!element.isConnected || element.closest(EXCLUDED_SELECTOR)) {
			return false;
		}
		const style = getComputedStyle(element);
		rememberLayoutSignature(element, style);
		if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
			return false;
		}
		const rectangle = element.getBoundingClientRect();
		return rectangle.width > 1 && rectangle.height > 1;
	}

	function createRecord(candidate) {
		const { element, text } = candidate;
		const languagePair = getElementLanguagePair(element, text);
		const originalHash = core.hashText(text);
		const existingState = state.elementStates.get(element);
		if (
			existingState &&
			existingState.originalHash === originalHash &&
			existingState.sourceLanguage === languagePair.sourceLanguage &&
			existingState.targetLanguage === languagePair.targetLanguage
		) {
			return null;
		}
		if (existingState) {
			invalidateElement(element);
		}
		const revision = (state.elementGenerations.get(element) ?? 0) + 1;
		state.elementGenerations.set(element, revision);
		if (!core.shouldTranslateText(text, languagePair.targetLanguage)) {
			state.elementStates.set(element, {
				originalHash,
				revision,
				sourceLanguage: languagePair.sourceLanguage,
				targetLanguage: languagePair.targetLanguage,
				status: "skipped",
				translationNode: null,
				counted: false,
				completed: false,
			});
			return null;
		}
		if (!isEligibleElement(element)) {
			state.deferredElements.add(element);
			return null;
		}
		state.deferredElements.delete(element);
		const parts = core.splitText(text, 3_500);
		if (parts.length === 0) {
			return null;
		}
		const record = {
			element,
			parts,
			translations: new Array(parts.length),
			originalHash,
			revision,
			sourceLanguage: languagePair.sourceLanguage,
			targetLanguage: languagePair.targetLanguage,
			priority: getElementPriority(element),
			rendered: false,
		};
		state.elementStates.set(element, {
			originalHash,
			revision: record.revision,
			sourceLanguage: record.sourceLanguage,
			targetLanguage: record.targetLanguage,
			status: "queued",
			translationNode: null,
			counted: false,
			completed: false,
		});
		return record;
	}

	function getElementLanguagePair(element, text) {
		let declaredElement = element;
		while (
			declaredElement &&
			declaredElement !== document.body &&
			declaredElement !== document.documentElement &&
			!declaredElement.getAttribute("lang")
		) {
			declaredElement = declaredElement.parentElement;
		}
		const declaredLanguage =
			declaredElement === document.body || declaredElement === document.documentElement
				? ""
				: declaredElement?.getAttribute("lang") || "";
		return core.getLanguagePair(declaredLanguage, text, state.settings.targetMode);
	}

	function getElementPriority(element) {
		const rectangle = element.getBoundingClientRect();
		const viewportHeight = Math.max(window.innerHeight, 1);
		if (rectangle.bottom >= -viewportHeight * 0.5 && rectangle.top <= viewportHeight * 1.5) {
			return Math.max(0, rectangle.top + viewportHeight * 0.5);
		}
		if (rectangle.top > viewportHeight * 1.5) {
			return 1_000_000 + rectangle.top;
		}
		return 2_000_000 + Math.abs(rectangle.bottom);
	}

	async function translateWithCloud(segments, runId) {
		const limits = core.getProviderLimits(state.settings.provider);
		const requestedConcurrency = Math.min(
			core.getProviderMaximumConcurrency(state.settings.provider),
			state.settings.concurrency,
		);
		const queue = [...segments];
		const resolvedTranslations = new Map();

		while (isCurrentRun(runId) && (queue.length > 0 || state.pendingRoots.size > 0)) {
			if (state.pendingRoots.size > 0) {
				enqueueCloudSegments(
					queue,
					collectSegments(takePendingRoots()),
					resolvedTranslations,
					runId,
				);
			}
			if (queue.length === 0) {
				continue;
			}
			const wave = [];
			for (let index = 0; index < requestedConcurrency && queue.length > 0; index += 1) {
				const batch = takeNextCloudBatch(queue, limits);
				wave.push({
					batch,
					request: translateCloudBatch(batch, resolvedTranslations, runId),
				});
			}
			const outcomes = await Promise.allSettled(wave.map((item) => item.request));
			let failed = null;
			for (const [index, outcome] of outcomes.entries()) {
				if (outcome.status === "rejected") {
					resetFailedBatch(wave[index].batch);
					failed ??= outcome;
				}
			}
			if (failed) {
				throw failed.reason;
			}
			await reportProgress(runId);
		}
	}

	function resetFailedBatch(batch) {
		const records = new Set(
			batch.items.flatMap((segment) => segment.targets.map((target) => target.record)),
		);
		for (const record of records) {
			const elementState = state.elementStates.get(record.element);
			if (elementState?.revision !== record.revision) {
				continue;
			}
			invalidateElement(record.element);
			queueRoot(record.element);
		}
	}

	function enqueueCloudSegments(queue, segments, resolvedTranslations, runId) {
		for (const segment of segments) {
			const key = getSegmentKey(segment);
			const resolved = resolvedTranslations.get(key);
			if (resolved) {
				applyTranslation(segment, resolved, runId);
				continue;
			}
			const queued = queue.find((item) => getSegmentKey(item) === key);
			if (queued) {
				queued.priority = Math.min(queued.priority, segment.priority);
				queued.targets.push(...segment.targets);
			} else {
				queue.push(segment);
			}
		}
	}

	function getSegmentKey(segment) {
		return `${segment.sourceLanguage}\u0000${segment.targetLanguage}\u0000${segment.text}`;
	}

	function takeNextCloudBatch(queue, limits) {
		queue.sort((left, right) => left.priority - right.priority);
		const first = queue[0];
		const visible = first.priority < 1_000_000;
		const candidates = queue.filter(
			(segment) =>
				segment.sourceLanguage === first.sourceLanguage &&
				segment.targetLanguage === first.targetLanguage &&
				(segment.priority < 1_000_000) === visible,
		);
		const maximumCharacters = visible
			? Math.min(3_000, limits.maximumCharacters)
			: limits.maximumCharacters;
		const maximumItems = visible ? Math.min(15, limits.maximumItems) : limits.maximumItems;
		const items = core.batchSegments(candidates, maximumCharacters, maximumItems)[0];
		const selected = new Set(items);
		for (let index = queue.length - 1; index >= 0; index -= 1) {
			if (selected.has(queue[index])) {
				queue.splice(index, 1);
			}
		}
		return {
			items,
			sourceLanguage: first.sourceLanguage,
			targetLanguage: first.targetLanguage,
		};
	}

	async function translateCloudBatch(batch, resolvedTranslations, runId) {
		const response = await sendMessage({
			type: "TRANSLATE_BATCH",
			runId,
			sourceLanguage: batch.sourceLanguage,
			targetLanguage: batch.targetLanguage,
			segments: batch.items.map(({ id, text }) => ({ id, text })),
		});
		if (!isCurrentRun(runId)) {
			return;
		}
		for (const result of response.results) {
			const segment = batch.items.find((item) => item.id === result.id);
			if (!segment || typeof result.text !== "string") {
				throw new Error("翻译服务返回了未知段落");
			}
			resolvedTranslations.set(getSegmentKey(segment), result.text);
			applyTranslation(segment, result.text, runId);
		}
	}

	function applyTranslation(segment, translation, runId) {
		if (!isCurrentRun(runId)) {
			return;
		}
		for (const target of segment.targets) {
			target.record.translations[target.partIndex] = translation.trim();
			renderRecordIfReady(target.record, runId);
		}
	}

	function renderRecordIfReady(record, runId) {
		if (
			record.rendered ||
			!record.element.isConnected ||
			record.translations.some((translation) => typeof translation !== "string")
		) {
			return;
		}
		const elementState = state.elementStates.get(record.element);
		if (
			!elementState ||
			elementState.revision !== record.revision ||
			elementState.originalHash !== record.originalHash
		) {
			return;
		}
		const currentCandidate = getCurrentElementCandidate(record.element);
		if (!currentCandidate || core.hashText(currentCandidate.text) !== record.originalHash) {
			invalidateElement(record.element);
			queueRoot(record.element);
			scheduleMutationPass(runId);
			return;
		}
		const translation = document.createElement("span");
		translation.className = "bt-translation";
		translation.dataset.btOwned = "true";
		translation.dataset.btRun = runId;
		translation.lang = record.targetLanguage === "zh" ? "zh-CN" : "en";
		translation.textContent = record.translations.join("\n");
		copySourcePresentation(record.element, translation);
		placeTranslation(
			record.element,
			translation,
			currentCandidate.placementAnchor,
			currentCandidate.partial,
		);
		record.rendered = true;
		elementState.status = "translated";
		elementState.translationNode = translation;
		elementState.completed = true;
		state.translationSources.set(translation, record.element);
		state.completed += 1;
	}

	function getCurrentElementCandidate(element) {
		return collectCandidateElements([element]).find((item) => item.element === element) ?? null;
	}

	function copySourcePresentation(source, translation) {
		const sourceStyle = getComputedStyle(source);
		rememberLayoutSignature(source, sourceStyle);
		const fontSize = Number.parseFloat(sourceStyle.fontSize);
		const fontScale = source.matches("h1, h2, h3, h4, h5, h6") ? 0.72 : 0.94;
		if (Number.isFinite(fontSize)) {
			translation.style.setProperty("--bt-source-font-size", `${fontSize * fontScale}px`);
		}
		for (const [property, value] of [
			["--bt-source-color", sourceStyle.color],
			["--bt-source-font-family", sourceStyle.fontFamily],
			["--bt-source-font-weight", sourceStyle.fontWeight],
			["--bt-source-line-height", sourceStyle.lineHeight],
			["--bt-source-text-align", sourceStyle.textAlign],
		]) {
			if (value) {
				translation.style.setProperty(property, value);
			}
		}
	}

	function placeTranslation(source, translation, placementAnchor, partial) {
		if (partial && placementAnchor !== source && placementAnchor.parentElement) {
			if (placementAnchor.nodeType === Node.ELEMENT_NODE) {
				placementAnchor.insertAdjacentElement("afterend", translation);
			} else {
				placementAnchor.parentElement.insertBefore(translation, placementAnchor.nextSibling);
			}
			return;
		}
		if (source.matches("li, td, th, caption, summary, dt, dd, button, [role='button']")) {
			source.append(translation);
			return;
		}
		const parentStyle = source.parentElement ? getComputedStyle(source.parentElement) : null;
		if (source.parentElement && parentStyle) {
			rememberLayoutSignature(source.parentElement, parentStyle);
		}
		if (
			parentStyle &&
			(parentStyle.display === "grid" ||
				(parentStyle.display.includes("flex") &&
					!String(parentStyle.flexDirection).startsWith("column")))
		) {
			source.append(translation);
			return;
		}
		source.insertAdjacentElement("afterend", translation);
	}

	async function reportProgress(runId) {
		if (!isCurrentRun(runId)) {
			return;
		}
		showStatus(`正在翻译 ${state.completed}/${state.total} 个文本块…`);
		await sendMessage({
			type: "STATUS",
			state: "working",
			completed: state.completed,
			total: state.total,
		});
	}

	function startMutationObserver(runId) {
		state.observer?.disconnect();
		state.observer = new MutationObserver((mutations) => {
			if (!isCurrentRun(runId)) {
				return;
			}
			let hasRelevantMutation = false;
			for (const mutation of mutations) {
				hasRelevantMutation = handleContentMutation(mutation) || hasRelevantMutation;
			}
			if (hasRelevantMutation) {
				scheduleMutationPass(runId);
			}
		});
		state.observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["class", "hidden", "lang", "style"],
			characterData: true,
			childList: true,
			subtree: true,
		});
	}

	function scheduleMutationPass(runId) {
		if (!isCurrentRun(runId) || state.mutationTimer !== null) {
			return;
		}
		state.mutationTimer = setTimeout(() => {
			state.mutationTimer = null;
			void runTranslationPass(runId).catch((error) => {
				if (isCurrentRun(runId)) {
					handleTranslationError(error);
				}
			});
		}, 180);
	}

	function scheduleVisibilitySweep(runId, target) {
		queueVisibilityTarget(target);
		if (!isCurrentRun(runId) || state.visibilityTimer !== null) {
			return;
		}
		state.visibilityTimer = setTimeout(() => {
			state.visibilityTimer = null;
			if (!isCurrentRun(runId)) {
				return;
			}
			const targets = [...state.visibilityTargets].filter((element) => element?.isConnected);
			state.visibilityTargets.clear();
			const trackedElements = new Set();
			const layoutRoots = new Set();
			for (const element of targets) {
				const trackedAncestor = findTrackedAncestor(element);
				if (updateLayoutSignature(element, Boolean(trackedAncestor))) {
					layoutRoots.add(element);
				}
				if (element.dataset?.btSource === runId) {
					trackedElements.add(element);
				}
				for (const source of element.querySelectorAll?.(
					`[data-bt-source="${CSS.escape(runId)}"]`,
				) ?? []) {
					trackedElements.add(source);
				}
				if (trackedAncestor) {
					trackedElements.add(trackedAncestor);
				}
			}
			for (const element of trackedElements) {
				if (updateLayoutSignature(element)) {
					layoutRoots.add(element);
				}
				if (element.parentElement && updateLayoutSignature(element.parentElement)) {
					layoutRoots.add(element.parentElement);
				}
			}

			let shouldScan = false;
			for (const element of layoutRoots) {
				const hasTrackedDescendant = Boolean(
					element.dataset?.btSource === runId ||
					element.querySelector?.(`[data-bt-source="${CSS.escape(runId)}"]`),
				);
				const scanRoot = hasTrackedDescendant
					? element
					: findTrackedAncestor(element) ?? element;
				invalidateTrackedSubtree(element, !hasTrackedDescendant);
				queueRoot(scanRoot);
				shouldScan = true;
			}
			for (const element of trackedElements) {
				const elementState = state.elementStates.get(element);
				if (!isEligibleElement(element)) {
					invalidateElement(element);
					state.deferredElements.add(element);
				} else if (elementState?.translationNode) {
					copySourcePresentation(element, elementState.translationNode);
				}
			}

			for (const element of [...state.deferredElements]) {
				if (!element.isConnected) {
					state.deferredElements.delete(element);
					continue;
				}
				const isAffected =
					targets.length === 0 ||
					targets.some(
						(targetElement) =>
							targetElement === element ||
							targetElement.contains(element) ||
							element.contains(targetElement),
					);
				if (isAffected && isEligibleElement(element)) {
					state.deferredElements.delete(element);
					queueRoot(element);
					shouldScan = true;
				}
			}
			if (shouldScan) {
				void runTranslationPass(runId).catch((error) => {
					if (isCurrentRun(runId)) {
						handleTranslationError(error);
					}
				});
			}
		}, 250);
	}

	function queueVisibilityTarget(element) {
		if (!element?.isConnected) {
			return;
		}
		for (const queued of state.visibilityTargets) {
			if (queued === element || queued.contains(element)) {
				return;
			}
			if (element.contains(queued)) {
				state.visibilityTargets.delete(queued);
			}
		}
		state.visibilityTargets.add(element);
	}

	function handleContentMutation(mutation) {
		if (mutation.type === "attributes") {
			if (isOwnedNode(mutation.target)) {
				return false;
			}
			if (mutation.attributeName === "class" || mutation.attributeName === "style") {
				scheduleVisibilitySweep(state.runId, mutation.target);
				return false;
			}
			if (mutation.attributeName === "hidden") {
				invalidateTrackedSubtree(mutation.target);
			}
			queueRoot(mutation.target);
			return true;
		}
		if (mutation.type === "characterData") {
			if (isOwnedNode(mutation.target)) {
				return false;
			}
			const tracked =
				state.textOwners.get(mutation.target) ?? findTrackedAncestor(mutation.target);
			if (tracked) {
				invalidateElement(tracked);
				queueRoot(tracked);
			} else {
				queueRoot(mutation.target);
			}
			return true;
		}

		const addedNodes = [...mutation.addedNodes].filter((node) => !isOwnedNode(node));
		const removedNodes = [...mutation.removedNodes];
		if (addedNodes.length === 0 && removedNodes.length === 0) {
			return false;
		}

		const affectedElements = new Set();
		const styleCache = new WeakMap();
		let shouldScan = false;
		for (const node of removedNodes) {
			if (isOwnedNode(node)) {
				shouldScan = recoverRemovedTranslation(node) || shouldScan;
			} else {
				forEachTextNode(node, (textNode) => {
					const owner = state.textOwners.get(textNode);
					if (owner) {
						affectedElements.add(owner);
					}
				});
				cleanupRemovedSubtree(node);
			}
		}
		for (const node of addedNodes) {
			forEachTextNode(node, (textNode) => {
				const candidate = findContentUnit(textNode.parentElement, styleCache);
				if (candidate && state.elementStates.has(candidate)) {
					affectedElements.add(candidate);
				}
			});
			queueRoot(node);
			shouldScan = true;
		}
		for (const element of affectedElements) {
			invalidateElement(element);
			if (element.isConnected) {
				queueRoot(element);
				shouldScan = true;
			}
		}
		return shouldScan;
	}

	function forEachTextNode(node, callback) {
		if (node.nodeType === Node.TEXT_NODE) {
			callback(node);
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return;
		}
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
			callback(textNode);
		}
	}

	function invalidateTrackedSubtree(root, includeAncestor = true) {
		const elements = new Set();
		if (includeAncestor) {
			const trackedAncestor = findTrackedAncestor(root);
			if (trackedAncestor) {
				elements.add(trackedAncestor);
			}
		}
		if (root.dataset?.btSource === state.runId) {
			elements.add(root);
		}
		for (const source of root.querySelectorAll?.(
			`[data-bt-source="${CSS.escape(state.runId)}"]`,
		) ?? []) {
			elements.add(source);
		}
		for (const element of elements) {
			invalidateElement(element);
		}
	}

	function isOwnedNode(node) {
		const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		return Boolean(element?.matches?.("[data-bt-owned='true']") || element?.closest?.("[data-bt-owned='true']"));
	}

	function findTrackedAncestor(node) {
		let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		for (; element; element = element.parentElement) {
			if (state.elementStates.has(element)) {
				return element;
			}
		}
		return null;
	}

	function invalidateElement(element) {
		state.deferredElements.delete(element);
		const elementState = state.elementStates.get(element);
		if (elementState?.counted) {
			state.total = Math.max(0, state.total - 1);
		}
		if (elementState?.completed) {
			state.completed = Math.max(0, state.completed - 1);
		}
		if (elementState?.translationNode) {
			const translation = elementState.translationNode;
			elementState.translationNode = null;
			elementState.status = "invalidated";
			translation.remove();
		}
		state.elementStates.delete(element);
		if (element.dataset.btSource === state.runId) {
			delete element.dataset.btSource;
		}
	}

	function recoverRemovedTranslation(node) {
		const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		const translations = [];
		if (element?.matches?.(".bt-translation[data-bt-owned='true']")) {
			translations.push(element);
		}
		for (const translation of element?.querySelectorAll?.(".bt-translation[data-bt-owned='true']") ?? []) {
			translations.push(translation);
		}
		let recovered = false;
		for (const translation of translations) {
			const source = state.translationSources.get(translation);
			const elementState = source ? state.elementStates.get(source) : null;
			if (source?.isConnected && elementState?.translationNode === translation) {
				invalidateElement(source);
				queueRoot(source);
				recovered = true;
			}
		}
		return recovered;
	}

	function cleanupRemovedSubtree(node) {
		const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		if (!element) {
			return;
		}
		for (const deferred of [...state.deferredElements]) {
			if (deferred === element || element.contains(deferred)) {
				state.deferredElements.delete(deferred);
			}
		}
		const sources = [];
		if (element.dataset?.btSource === state.runId) {
			sources.push(element);
		}
		for (const source of element.querySelectorAll?.(`[data-bt-source="${CSS.escape(state.runId)}"]`) ?? []) {
			sources.push(source);
		}
		for (const source of sources) {
			invalidateElement(source);
		}
	}

	function handleTranslationError(error) {
		if (!state.active || error?.name === "AbortError" || error?.message === "翻译已取消") {
			return;
		}
		const message =
			typeof error?.message === "string" && error.message ? error.message : "未知翻译错误";
		showStatus(message, {
			actionLabel: error?.requiresSettings ? "选择云服务" : "打开设置",
			onAction: () => void sendMessage({ type: "OPEN_OPTIONS" }),
		});
		void sendMessage({ type: "STATUS", state: "error", error: message });
	}

	function showStatus(text, action = null) {
		if (state.statusTimer !== null) {
			clearTimeout(state.statusTimer);
			state.statusTimer = null;
		}
		const status = ensureStatusNode();
		const textNode = status.querySelector(".bt-status__text");
		textNode.textContent = text;
		status.querySelector(".bt-status__action")?.remove();
		if (action) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "bt-status__action";
			button.dataset.btOwned = "true";
			button.textContent = action.actionLabel;
			button.addEventListener("click", action.onAction, { once: true });
			status.append(button);
		}
	}

	function ensureStatusNode() {
		if (state.statusNode?.isConnected) {
			return state.statusNode;
		}
		const status = document.createElement("div");
		status.className = "bt-status";
		status.dataset.btOwned = "true";
		status.setAttribute("role", "status");
		status.setAttribute("aria-live", "polite");
		const text = document.createElement("span");
		text.className = "bt-status__text";
		text.dataset.btOwned = "true";
		status.append(text);
		document.documentElement.append(status);
		state.statusNode = status;
		return status;
	}

	async function sendMessage(message) {
		const response = await chrome.runtime.sendMessage(message);
		if (!response?.ok) {
			throw new Error(response?.error || "扩展后台无响应");
		}
		return response;
	}
})();

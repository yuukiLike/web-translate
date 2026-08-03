(() => {
	"use strict";

	const core = globalThis.BilingualTranslatorCore;
	const catalog = globalThis.BilingualTranslatorProviderCatalog;
	const modelProviderIds = ["deepseek", "openai", "google", "anthropic"];
	const tokenUsageProviders = new Set(modelProviderIds);
	const extensionVersion = chrome.runtime.getManifest().version;
	document.querySelector("#extension-version").textContent = `v${extensionVersion}`;
	const form = document.querySelector("#settings-form");
	const provider = document.querySelector("#provider");
	const status = document.querySelector("#status");
	const usage = document.querySelector("#usage");
	const catalogStatus = document.querySelector("#catalog-status");
	const debugLogging = document.querySelector("#debug-logging");
	const debugConnection = document.querySelector("#debug-connection");
	const debugEvents = document.querySelector("#debug-events");
	const debugEventLimit = 300;
	let currentSettings = core.createDefaultSettings();
	let savedDebugLogging = false;
	let debugPort;
	let debugReconnectTimer;
	let debugHeartbeatTimer;

	provider.addEventListener("change", updateProviderPanels);
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void saveSettings();
	});
	document.querySelector("#test-provider").addEventListener("click", () => void testProvider());
	document.querySelector("#clear-cache").addEventListener("click", () => void clearCache());
	document.querySelector("#clear-debug-logs").addEventListener("click", () => void clearDebugLogs());
	debugLogging.addEventListener("change", updateDebugConnection);
	chrome.storage.onChanged.addListener(handleSettingsStorageChange);
	document.addEventListener("visibilitychange", handleDebugVisibilityChange);
	window.addEventListener("beforeunload", disconnectDebugPort);

	initializeCatalogUi();
	void loadState();

	function initializeCatalogUi() {
		if (!core.isRecord(catalog) || !core.isRecord(catalog.providers)) {
			catalogStatus.textContent = "固定本地模型目录未载入。请重新构建并重新加载扩展。";
			catalogStatus.dataset.error = "true";
			for (const providerId of modelProviderIds) {
				renderMissingCatalogSelect(providerId);
			}
			return;
		}

		const source = core.isRecord(catalog.source) ? catalog.source : {};
		const commit = typeof source.commit === "string" ? source.commit.trim() : "";
		document.querySelector("#catalog-source-sha").textContent = commit ? commit.slice(0, 8) : "未知";
		const fetchedAt = document.querySelector("#catalog-fetched-at");
		const fetchedDate = new Date(typeof source.fetchedAt === "string" ? source.fetchedAt : "");
		if (Number.isNaN(fetchedDate.getTime())) {
			fetchedAt.textContent =
				typeof source.fetchedAt === "string" && source.fetchedAt.trim()
					? source.fetchedAt.trim().slice(0, 80)
					: "未知";
		} else {
			fetchedAt.dateTime = fetchedDate.toISOString();
			fetchedAt.title = fetchedDate.toISOString();
			fetchedAt.textContent = new Intl.DateTimeFormat("zh-CN", {
				dateStyle: "medium",
				timeStyle: "short",
			}).format(fetchedDate);
		}

		let complete = true;
		for (const providerId of modelProviderIds) {
			complete = renderCatalogModels(providerId) && complete;
		}
		catalogStatus.dataset.error = String(!complete);
	}

	function renderCatalogModels(providerId) {
		const select = document.querySelector(`#${providerId}-model`);
		const catalogProvider = catalog.providers[providerId];
		if (!core.isRecord(catalogProvider) || !core.isRecord(catalogProvider.models)) {
			renderMissingCatalogSelect(providerId);
			return false;
		}

		const models = Object.entries(catalogProvider.models)
			.map(([modelId, model]) => {
				if (!core.isRecord(model)) {
					return undefined;
				}
				const normalizedId =
					typeof model.id === "string" && model.id.trim() ? model.id.trim() : modelId.trim();
				return normalizedId ? { ...model, id: normalizedId } : undefined;
			})
			.filter(Boolean);
		const defaultModelId =
			typeof catalogProvider.defaultModelId === "string" ? catalogProvider.defaultModelId : "";
		models.sort((left, right) => {
			if (left.id === defaultModelId) {
				return -1;
			}
			if (right.id === defaultModelId) {
				return 1;
			}
			return 0;
		});

		if (models.length === 0) {
			renderMissingCatalogSelect(providerId);
			return false;
		}

		select.replaceChildren(
			...models.map((model) => {
				const option = document.createElement("option");
				option.value = model.id;
				option.textContent = formatModelLabel(model);
				return option;
			}),
		);
		select.disabled = false;
		return true;
	}

	function renderMissingCatalogSelect(providerId) {
		const select = document.querySelector(`#${providerId}-model`);
		const option = document.createElement("option");
		option.value = "";
		option.textContent = "本地目录未载入";
		select.replaceChildren(option);
		select.disabled = true;
	}

	function formatModelLabel(model) {
		const name =
			typeof model.name === "string" && model.name.trim() ? model.name.trim().slice(0, 180) : model.id;
		const details = [];
		const cost = core.isRecord(model.cost) ? model.cost : {};
		if (Number.isFinite(cost.input) || Number.isFinite(cost.output)) {
			details.push(`输入 $${formatDecimal(cost.input)} / 输出 $${formatDecimal(cost.output)} 每 1M token`);
		}
		const limits = core.isRecord(model.limits) ? model.limits : {};
		if (Number.isFinite(limits.context)) {
			details.push(`上下文 ${formatNumber(limits.context)} token`);
		}
		const identity = name === model.id ? name : `${name} — ${model.id}`;
		return details.length > 0 ? `${identity} · ${details.join(" · ")}` : identity;
	}

	function formatDecimal(value) {
		return Number.isFinite(value)
			? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value)
			: "—";
	}

	async function loadState() {
		try {
			const response = await sendMessage({ type: "GET_OPTIONS_STATE" });
			currentSettings = core.normalizeSettings(response.settings);
			writeSettings(currentSettings);
			renderUsage(response.usage);
			updateProviderPanels();
			savedDebugLogging = currentSettings.debugLogging;
			updateDebugConnection();
		} catch (error) {
			setStatus(getErrorMessage(error), true);
		}
	}

	function handleSettingsStorageChange(changes, areaName) {
		if (areaName !== "local" || !core.isRecord(changes)) {
			return;
		}
		const changedSettings = changes[core.SETTINGS_KEY];
		if (!core.isRecord(changedSettings) || !core.isRecord(changedSettings.newValue)) {
			return;
		}
		const settings = core.normalizeSettings(changedSettings.newValue);
		if (settings.debugLogging === savedDebugLogging && debugLogging.checked === savedDebugLogging) {
			return;
		}
		currentSettings = { ...currentSettings, debugLogging: settings.debugLogging };
		savedDebugLogging = settings.debugLogging;
		debugLogging.checked = settings.debugLogging;
		updateDebugConnection();
	}

	function writeSettings(settings) {
		provider.value = settings.provider;
		document.querySelector("#target-mode").value = settings.targetMode;
		document.querySelector("#translate-dynamic").checked = settings.translateDynamicContent;
		document.querySelector("#concurrency").value = String(settings.concurrency);
		document.querySelector("#azure-api-key").value = settings.azure.apiKey;
		document.querySelector("#azure-region").value = settings.azure.region;
		document.querySelector("#deepl-api-key").value = settings.deepl.apiKey;
		for (const providerId of modelProviderIds) {
			const providerSettings = core.isRecord(settings[providerId]) ? settings[providerId] : {};
			document.querySelector(`#${providerId}-api-key`).value =
				typeof providerSettings.apiKey === "string" ? providerSettings.apiKey : "";
			setModelSelection(providerId, providerSettings.model);
		}
		debugLogging.checked = settings.debugLogging;
	}

	function setModelSelection(providerId, modelId) {
		const select = document.querySelector(`#${providerId}-model`);
		const requestedModelId = typeof modelId === "string" ? modelId : "";
		if ([...select.options].some((option) => option.value === requestedModelId)) {
			select.value = requestedModelId;
			return;
		}
		const catalogProvider = core.isRecord(catalog?.providers?.[providerId])
			? catalog.providers[providerId]
			: {};
		const defaultModelId =
			typeof catalogProvider.defaultModelId === "string" ? catalogProvider.defaultModelId : "";
		select.value = [...select.options].some((option) => option.value === defaultModelId)
			? defaultModelId
			: select.options[0]?.value || "";
	}

	function readSettings() {
		return core.normalizeSettings({
			provider: provider.value,
			targetMode: document.querySelector("#target-mode").value,
			translateDynamicContent: document.querySelector("#translate-dynamic").checked,
			concurrency: Number.parseInt(document.querySelector("#concurrency").value, 10),
			debugLogging: debugLogging.checked,
			azure: {
				apiKey: document.querySelector("#azure-api-key").value,
				region: document.querySelector("#azure-region").value,
			},
			deepl: {
				apiKey: document.querySelector("#deepl-api-key").value,
			},
			deepseek: readModelProviderSettings("deepseek"),
			openai: readModelProviderSettings("openai"),
			google: readModelProviderSettings("google"),
			anthropic: readModelProviderSettings("anthropic"),
		});
	}

	function readModelProviderSettings(providerId) {
		return {
			apiKey: document.querySelector(`#${providerId}-api-key`).value,
			model: document.querySelector(`#${providerId}-model`).value,
		};
	}

	async function saveSettings() {
		setStatus("正在保存设置…");
		try {
			const settings = readSettings();
			assertProviderConfigured(settings);
			const response = await sendMessage({ type: "SAVE_SETTINGS", settings });
			currentSettings = core.normalizeSettings(response.settings);
			savedDebugLogging = currentSettings.debugLogging;
			writeSettings(currentSettings);
			updateProviderPanels();
			updateDebugConnection();
			setStatus("设置已保存");
		} catch (error) {
			setStatus(getErrorMessage(error), true);
		}
	}

	async function testProvider() {
		setStatus("正在测试连接…");
		try {
			const settings = readSettings();
			assertProviderConfigured(settings);
			const saved = await sendMessage({ type: "SAVE_SETTINGS", settings });
			currentSettings = core.normalizeSettings(saved.settings);
			savedDebugLogging = currentSettings.debugLogging;
			writeSettings(currentSettings);
			updateProviderPanels();
			const response = await sendMessage({ type: "TEST_PROVIDER" });
			setStatus(response.message);
			updateDebugConnection();
			await refreshUsage();
		} catch (error) {
			setStatus(getErrorMessage(error), true);
		}
	}

	function assertProviderConfigured(settings) {
		const configurationError = core.getProviderConfigurationError(settings);
		if (configurationError) {
			throw new Error(configurationError);
		}
	}

	async function clearCache() {
		setStatus("正在清理缓存…");
		try {
			const response = await sendMessage({ type: "CLEAR_CACHE" });
			setStatus(`已删除 ${response.removed} 个缓存条目`);
		} catch (error) {
			setStatus(getErrorMessage(error), true);
		}
	}

	async function refreshUsage() {
		const response = await sendMessage({ type: "GET_OPTIONS_STATE" });
		renderUsage(response.usage);
	}

	function renderUsage(allUsage) {
		const monthUsage = allUsage?.[core.getMonthKey()];
		if (!core.isRecord(monthUsage) || Object.keys(monthUsage).length === 0) {
			const empty = document.createElement("p");
			empty.className = "empty";
			empty.textContent = "暂无云端调用记录。";
			usage.replaceChildren(empty);
			return;
		}
		usage.replaceChildren(
			...Object.entries(monthUsage).map(([name, metrics]) => {
				const safeMetrics = core.isRecord(metrics) ? metrics : {};
				const row = document.createElement("div");
				row.className = "usage-row";
				const title = document.createElement("strong");
				title.textContent = getProviderLabel(name);
				const usesTokens = tokenUsageProviders.has(name);
				row.append(
					title,
					createMetric("API 请求", safeMetrics.apiCalls),
					createMetric("提交字符", safeMetrics.charactersSubmitted),
					createMetric("缓存命中", safeMetrics.cachedCharacters),
					createMetric(
						usesTokens ? "输入 / 输出 token" : "计费字符",
						usesTokens
							? `${formatNumber(safeMetrics.inputTokens)} / ${formatNumber(safeMetrics.outputTokens)}`
							: safeMetrics.billedCharacters,
					),
				);
				return row;
			}),
		);
	}

	function getProviderLabel(name) {
		try {
			return core.getProviderLabel(name, currentSettings);
		} catch {
			return name;
		}
	}

	function createMetric(label, value) {
		const metric = document.createElement("span");
		metric.className = "metric";
		const labelNode = document.createTextNode(label);
		const number = document.createElement("b");
		number.textContent = typeof value === "string" ? value : formatNumber(value);
		metric.append(labelNode, number);
		return metric;
	}

	function formatNumber(value) {
		return new Intl.NumberFormat("zh-CN").format(typeof value === "number" ? value : 0);
	}

	function updateProviderPanels() {
		for (const panel of document.querySelectorAll("[data-provider-panel]")) {
			panel.hidden = panel.dataset.providerPanel !== provider.value;
		}
	}

	function updateDebugConnection() {
		if (!debugLogging.checked) {
			disconnectDebugPort();
			setDebugConnection(savedDebugLogging ? "已断开；保存设置后停止记录" : "调试已关闭", "off");
			return;
		}
		connectDebugPort();
		if (!savedDebugLogging) {
			setDebugConnection("已连接；保存设置后开始记录", "connected");
		}
		void loadDebugEvents();
	}

	function connectDebugPort() {
		if (debugPort) {
			return;
		}
		clearTimeout(debugReconnectTimer);
		debugReconnectTimer = undefined;
		try {
			const port = chrome.runtime.connect({ name: "debug-events-v1" });
			debugPort = port;
			port.onMessage.addListener((message) => {
				if (message?.type === "DEBUG_EVENT" && core.isRecord(message.event)) {
					appendDebugEvent(message.event);
				} else if (message?.type === "DEBUG_SNAPSHOT" && Array.isArray(message.events)) {
					renderDebugEvents(message.events);
				} else if (message?.type === "DEBUG_RESET") {
					renderDebugEvents([]);
				}
			});
			port.onDisconnect.addListener(() => {
				void chrome.runtime.lastError;
				clearInterval(debugHeartbeatTimer);
				debugHeartbeatTimer = undefined;
				if (debugPort === port) {
					debugPort = undefined;
				}
				if (debugLogging.checked) {
					setDebugConnection("调试连接已断开", "error");
					if (document.visibilityState === "visible") {
						debugReconnectTimer = setTimeout(connectDebugPort, 1_000);
					}
				}
			});
			updateDebugHeartbeat();
			setDebugConnection("实时调试已连接", "connected");
		} catch (error) {
			setDebugConnection(getErrorMessage(error), "error");
		}
	}

	function disconnectDebugPort() {
		clearTimeout(debugReconnectTimer);
		debugReconnectTimer = undefined;
		clearInterval(debugHeartbeatTimer);
		debugHeartbeatTimer = undefined;
		if (!debugPort) {
			return;
		}
		const port = debugPort;
		debugPort = undefined;
		port.disconnect();
	}

	function updateDebugHeartbeat() {
		clearInterval(debugHeartbeatTimer);
		debugHeartbeatTimer = undefined;
		if (!debugPort || !debugLogging.checked || document.visibilityState !== "visible") {
			return;
		}
		debugHeartbeatTimer = setInterval(() => {
			try {
				debugPort?.postMessage({ type: "DEBUG_PING" });
			} catch {
				// onDisconnect owns reconnection and status updates.
			}
		}, 20_000);
	}

	function handleDebugVisibilityChange() {
		if (!debugLogging.checked) {
			return;
		}
		if (document.visibilityState === "visible") {
			connectDebugPort();
			updateDebugHeartbeat();
			void loadDebugEvents();
		} else {
			clearInterval(debugHeartbeatTimer);
			debugHeartbeatTimer = undefined;
		}
	}

	async function loadDebugEvents() {
		if (!debugLogging.checked) {
			return;
		}
		try {
			const response = await sendMessage({ type: "GET_DEBUG_LOGS" });
			renderDebugEvents(response.events);
		} catch (error) {
			setDebugConnection(getErrorMessage(error), "error");
		}
	}

	async function clearDebugLogs() {
		try {
			await sendMessage({ type: "CLEAR_DEBUG_LOGS" });
			renderDebugEvents([]);
			setDebugConnection(
				debugLogging.checked
					? savedDebugLogging
						? "事件已清空，实时调试已连接"
						: "事件已清空；保存设置后开始记录"
					: "事件已清空",
				debugLogging.checked ? "connected" : "off",
			);
		} catch (error) {
			setDebugConnection(getErrorMessage(error), "error");
		}
	}

	function renderDebugEvents(events) {
		const safeEvents = Array.isArray(events)
			? events.filter((event) => core.isRecord(event)).slice(-debugEventLimit)
			: [];
		if (safeEvents.length === 0) {
			const empty = document.createElement("p");
			empty.className = "empty";
			empty.textContent = debugLogging.checked
				? "尚无调试事件。触发一次网页翻译或测试连接即可查看。"
				: "开启调试模式并保存后，这里会实时显示脱敏事件。";
			debugEvents.replaceChildren(empty);
			return;
		}
		debugEvents.replaceChildren(...safeEvents.map(createDebugEvent));
		debugEvents.scrollTop = debugEvents.scrollHeight;
	}

	function appendDebugEvent(event) {
		const empty = debugEvents.querySelector(".empty");
		if (empty) {
			empty.remove();
		}
		debugEvents.append(createDebugEvent(event));
		while (debugEvents.childElementCount > debugEventLimit) {
			debugEvents.firstElementChild?.remove();
		}
		debugEvents.scrollTop = debugEvents.scrollHeight;
	}

	function createDebugEvent(event) {
		const row = document.createElement("div");
		row.className = "debug-event";
		const failed =
			(typeof event.httpStatus === "number" && event.httpStatus >= 400) ||
			(typeof event.errorCode === "string" && event.errorCode) ||
			["error", "failed"].includes(event.status);
		row.dataset.status = failed ? "error" : "ok";

		const time = document.createElement("time");
		time.className = "debug-event-time";
		time.textContent = formatDebugTime(event.timestamp);
		if (typeof event.timestamp === "string") {
			time.dateTime = event.timestamp;
		}

		const name = document.createElement("span");
		name.className = "debug-event-name";
		name.textContent = scalarText(event.eventType) || scalarText(event.operation) || "DEBUG_EVENT";

		const metadata = document.createElement("span");
		metadata.className = "debug-event-meta";
		const fields = [
			["序号", event.seq],
			["扩展版本", event.extensionVersion],
			["目录 SHA", event.catalogSourceSha],
			["Worker", event.workerInstanceId],
			["组件", event.component],
			["操作", event.operation],
			["服务", event.provider],
			["Adapter", event.providerAdapter],
			["API Host", formatApiHost(event.apiHost)],
			["推理策略", event.inferencePolicy],
			["模型", event.model],
			["响应 ID", event.responseId],
			["响应模型", event.responseModel],
			["结束原因", event.finishReason],
			["原始结束原因", event.rawFinishReason],
			["警告数", event.warningCount],
			["语言", formatLanguagePair(event.sourceLanguage, event.targetLanguage)],
			["方法", event.method],
			["端点", formatEndpoint(event.endpoint)],
			["尝试", event.attempt],
			["配置并发", event.configuredConcurrency],
			["批次序号", event.batchIndex],
			["批次数", event.batchCount],
			["队列深度", event.queueDepth],
			["段落", event.segmentCount],
			["原文字符", event.sourceCharacters],
			["缓存命中", event.cacheHits],
			["缓存未命中", event.cacheMisses],
			["HTTP", event.httpStatus],
			["耗时", withUnit(event.elapsedMs, "ms")],
			["超时", withUnit(event.timeoutMs, "ms")],
			["重试等待", withUnit(event.retryAfterMs, "ms")],
			["输入 token", event.inputTokens],
			["缓存读取 token", event.cacheReadTokens],
			["缓存写入 token", event.cacheWriteTokens],
			["非缓存 token", event.noCacheTokens],
			["输出 token", event.outputTokens],
			["计费字符", event.billedCharacters],
			["状态", event.status],
			["错误码", event.errorCode],
			["可重试", booleanText(event.retryable)],
			["已取消", booleanText(event.cancelled)],
			["标签页", event.tabId],
			["运行", event.runId],
			["请求", event.requestId],
		];
		for (const [label, value] of fields) {
			const textValue = scalarText(value);
			if (!textValue) {
				continue;
			}
			const item = document.createElement("span");
			item.textContent = `${label}: ${textValue}`;
			metadata.append(item);
		}
		row.append(time, name, metadata);
		return row;
	}

	function formatDebugTime(value) {
		const date = new Date(typeof value === "number" || typeof value === "string" ? value : Date.now());
		if (Number.isNaN(date.getTime())) {
			return "时间未知";
		}
		return new Intl.DateTimeFormat("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(date);
	}

	function scalarText(value) {
		if (typeof value === "number" && Number.isFinite(value)) {
			return formatNumber(value);
		}
		return typeof value === "string" ? value.trim().slice(0, 160) : "";
	}

	function formatApiHost(value) {
		if (typeof value !== "string") {
			return "";
		}
		const host = value.trim();
		if (/^[a-z0-9.-]+(?::\d+)?$/iu.test(host)) {
			return host.slice(0, 255);
		}
		try {
			return new URL(host).host;
		} catch {
			return "";
		}
	}

	function formatEndpoint(value) {
		if (typeof value !== "string") {
			return "";
		}
		try {
			const url = new URL(value);
			return `${url.origin}${url.pathname}`;
		} catch {
			return "";
		}
	}

	function formatLanguagePair(sourceLanguage, targetLanguage) {
		return typeof sourceLanguage === "string" && typeof targetLanguage === "string"
			? `${sourceLanguage} → ${targetLanguage}`
			: "";
	}

	function withUnit(value, unit) {
		return typeof value === "number" && Number.isFinite(value) ? `${formatNumber(value)} ${unit}` : "";
	}

	function booleanText(value) {
		return typeof value === "boolean" ? (value ? "是" : "否") : "";
	}

	function setDebugConnection(message, state) {
		debugConnection.textContent = message;
		debugConnection.dataset.state = state;
	}

	function setStatus(message, isError = false) {
		status.textContent = message;
		status.dataset.error = String(isError);
	}

	async function sendMessage(message) {
		const response = await chrome.runtime.sendMessage(message);
		if (!response?.ok) {
			throw new Error(response?.error || "扩展后台无响应");
		}
		return response;
	}

	function getErrorMessage(error) {
		return error instanceof Error && error.message ? error.message : "未知错误";
	}
})();

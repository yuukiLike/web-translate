(() => {
	"use strict";

	const core = globalThis.BilingualTranslatorCore;
	const form = document.querySelector("#settings-form");
	const provider = document.querySelector("#provider");
	const status = document.querySelector("#status");
	const usage = document.querySelector("#usage");

	provider.addEventListener("change", updateProviderPanels);
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void saveSettings();
	});
	document.querySelector("#test-provider").addEventListener("click", () => void testProvider());
	document.querySelector("#clear-cache").addEventListener("click", () => void clearCache());

	void loadState();

	async function loadState() {
		try {
			const response = await sendMessage({ type: "GET_OPTIONS_STATE" });
			writeSettings(response.settings);
			renderUsage(response.usage);
			updateProviderPanels();
		} catch (error) {
			setStatus(getErrorMessage(error), true);
		}
	}

	function writeSettings(settings) {
		provider.value = settings.provider;
		document.querySelector("#target-mode").value = settings.targetMode;
		document.querySelector("#translate-dynamic").checked = settings.translateDynamicContent;
		document.querySelector("#concurrency").value = String(settings.concurrency);
		document.querySelector("#azure-api-key").value = settings.azure.apiKey;
		document.querySelector("#azure-region").value = settings.azure.region;
		document.querySelector("#deepl-api-key").value = settings.deepl.apiKey;
		document.querySelector("#deepseek-api-key").value = settings.deepseek.apiKey;
		document.querySelector("#deepseek-model").value = settings.deepseek.model;
	}

	function readSettings() {
		return core.normalizeSettings({
			provider: provider.value,
			targetMode: document.querySelector("#target-mode").value,
			translateDynamicContent: document.querySelector("#translate-dynamic").checked,
			concurrency: Number.parseInt(document.querySelector("#concurrency").value, 10),
			azure: {
				apiKey: document.querySelector("#azure-api-key").value,
				region: document.querySelector("#azure-region").value,
			},
			deepl: {
				apiKey: document.querySelector("#deepl-api-key").value,
			},
			deepseek: {
				apiKey: document.querySelector("#deepseek-api-key").value,
				model: document.querySelector("#deepseek-model").value,
			},
		});
	}

	async function saveSettings() {
		try {
			const settings = readSettings();
			assertProviderConfigured(settings);
			const response = await sendMessage({ type: "SAVE_SETTINGS", settings });
			writeSettings(response.settings);
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
			await sendMessage({ type: "SAVE_SETTINGS", settings });
			const response = await sendMessage({ type: "TEST_PROVIDER" });
			setStatus(response.message);
			await refreshUsage();
		} catch (error) {
			setStatus(getErrorMessage(error), true);
		}
	}

	function assertProviderConfigured(settings) {
		const apiKey = settings[settings.provider]?.apiKey;
		if (!apiKey) {
			const labels = {
				azure: "Azure",
				deepl: "DeepL",
				deepseek: "DeepSeek",
			};
			throw new Error(`请先填写 ${labels[settings.provider]} API Key`);
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
				const row = document.createElement("div");
				row.className = "usage-row";
				const title = document.createElement("strong");
				title.textContent = name;
				row.append(
					title,
					createMetric("API 请求", metrics.apiCalls),
					createMetric("提交字符", metrics.charactersSubmitted),
					createMetric("缓存命中", metrics.cachedCharacters),
					createMetric(
						name === "deepseek" ? "输入 / 输出 token" : "计费字符",
						name === "deepseek"
							? `${formatNumber(metrics.inputTokens)} / ${formatNumber(metrics.outputTokens)}`
							: metrics.billedCharacters,
					),
				);
				return row;
			}),
		);
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

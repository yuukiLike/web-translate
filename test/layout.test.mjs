import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const extensionRootUrl = new URL("../chrome-extension/", import.meta.url);
const manifestUrl = new URL("manifest.json", extensionRootUrl);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));

function assertFilesExist(paths, baseUrl) {
	for (const path of paths) {
		assert.equal(existsSync(new URL(path, baseUrl)), true, `Missing packaged file: ${path}`);
	}
}

function getInjectedFiles(serviceWorkerSource, methodName) {
	const callStart = serviceWorkerSource.indexOf(`chrome.scripting.${methodName}(`);
	assert.notEqual(callStart, -1, `Missing chrome.scripting.${methodName}()`);
	const fileListMatch = serviceWorkerSource.slice(callStart).match(/\bfiles:\s*(\[[\s\S]*?\])/u);
	assert.ok(fileListMatch, `Missing files list in chrome.scripting.${methodName}()`);
	return [...fileListMatch[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

test("manifest entries and options assets resolve inside the packaged extension", () => {
	assert.deepEqual(manifest.background, {
		service_worker: "background/service-worker.js",
		type: "module",
	});
	assert.equal(manifest.options_ui.page, "options/index.html");
	assert.deepEqual(manifest.icons, {
		16: "assets/icons/icon-16.png",
		32: "assets/icons/icon-32.png",
		48: "assets/icons/icon-48.png",
		128: "assets/icons/icon-128.png",
	});
	assert.deepEqual(manifest.action.default_icon, {
		16: "assets/icons/icon-16.png",
		32: "assets/icons/icon-32.png",
	});
	assertFilesExist(Object.values(manifest.icons), extensionRootUrl);

	const serviceWorkerUrl = new URL(manifest.background.service_worker, extensionRootUrl);
	const optionsPageUrl = new URL(manifest.options_ui.page, extensionRootUrl);
	assert.equal(existsSync(serviceWorkerUrl), true);
	assert.equal(existsSync(optionsPageUrl), true);

	const serviceWorkerSource = readFileSync(serviceWorkerUrl, "utf8");
	const workerImports = [...serviceWorkerSource.matchAll(/^import "([^"]+)";$/gmu)].map(
		(match) => match[1],
	);
	assert.deepEqual(workerImports, [
		"../generated/provider-catalog.js",
		"../shared/core.js",
		"../generated/provider-runtime.js",
	]);
	assertFilesExist(workerImports, serviceWorkerUrl);

	const optionsHtml = readFileSync(optionsPageUrl, "utf8");
	const stylesheets = [...optionsHtml.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/giu)].map(
		(match) => match[1],
	);
	const scripts = [...optionsHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/giu)].map(
		(match) => match[1],
	);
	assert.deepEqual(stylesheets, ["options.css"]);
	assert.deepEqual(scripts, [
		"../generated/provider-catalog.js",
		"../shared/core.js",
		"options.js",
	]);
	assertFilesExist([...stylesheets, ...scripts], optionsPageUrl);
});

test("dynamic injection preserves dependency order and references packaged files", () => {
	const serviceWorkerUrl = new URL(manifest.background.service_worker, extensionRootUrl);
	const serviceWorkerSource = readFileSync(serviceWorkerUrl, "utf8");
	const insertCssPosition = serviceWorkerSource.indexOf("chrome.scripting.insertCSS(");
	const executeScriptPosition = serviceWorkerSource.indexOf("chrome.scripting.executeScript(");

	assert.ok(insertCssPosition >= 0);
	assert.ok(executeScriptPosition > insertCssPosition);

	const cssFiles = getInjectedFiles(serviceWorkerSource, "insertCSS");
	const scriptFiles = getInjectedFiles(serviceWorkerSource, "executeScript");
	assert.deepEqual(cssFiles, ["content/content.css"]);
	assert.deepEqual(scriptFiles, [
		"generated/provider-catalog.js",
		"shared/core.js",
		"content/content-script.js",
	]);
	assertFilesExist([...cssFiles, ...scriptFiles], extensionRootUrl);
});

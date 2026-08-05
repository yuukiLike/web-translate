import "../generated/provider-catalog.js";
import "../generated/core.js";
import "../generated/provider-runtime.js";
import { createBackgroundApp } from "./app.js";

const app = createBackgroundApp({
	chrome,
	core: globalThis.BilingualTranslatorCore,
	providerCatalog: globalThis.BilingualTranslatorProviderCatalog,
	providerRuntime: globalThis.BilingualTranslatorProviderRuntime,
});

chrome.runtime.onInstalled.addListener(app.onInstalled);
chrome.contextMenus.onClicked.addListener(app.onContextMenuClicked);
chrome.runtime.onMessage.addListener(app.onMessage);
chrome.runtime.onConnect.addListener(app.onConnect);
chrome.tabs.onRemoved.addListener(app.onTabRemoved);

void app.start().catch(() => {});

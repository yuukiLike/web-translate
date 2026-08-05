import "./popup.css";
import { createPopupApp } from "./popup-app.js";

const app = createPopupApp({
	chrome,
	document,
	closePopup: () => globalThis.close(),
});

void app.load();

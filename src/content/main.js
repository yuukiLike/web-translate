import { installController } from "./controller.js";
import { CONTROLLER_KEY } from "./constants.js";

const existingController = globalThis[CONTROLLER_KEY];
if (existingController) {
	void existingController.toggle();
} else {
	const core = globalThis.BilingualTranslatorCore;
	if (!core) {
		throw new Error("双语翻译核心未加载");
	}
	installController(core);
}

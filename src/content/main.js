import { installController } from "./controller.js";

const core = globalThis.BilingualTranslatorCore;
if (!core) throw new Error("双语翻译核心未加载");
if (!core.getPageAccessError(location.href)) installController(core);

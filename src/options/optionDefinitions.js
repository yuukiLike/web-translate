export const MODEL_PROVIDER_IDS = Object.freeze(["deepseek", "openai", "google", "anthropic"]);

export const PROVIDERS = Object.freeze([
	Object.freeze({
		id: "deepseek",
		name: "DeepSeek",
		cue: "默认 · 低成本",
		note: "关闭思考模式，适合日常双语翻译。感谢梁圣。",
		kind: "model",
		recommended: true,
		paid: true,
	}),
	Object.freeze({
		id: "openai",
		name: "OpenAI",
		cue: "稳定 · 高吞吐",
		note: "官方 API，响应稳定。",
		kind: "model",
		recommended: true,
		paid: true,
	}),
	Object.freeze({
		id: "google",
		name: "Gemini",
		cue: "可用免费层",
		note: "配额以 Google 账号与区域政策为准。",
		kind: "model",
		recommended: true,
	}),
	Object.freeze({
		id: "anthropic",
		name: "Anthropic",
		cue: "高质量",
		note: "适合偏好 Claude 的场景。",
		kind: "model",
		recommended: false,
		paid: true,
	}),
	Object.freeze({
		id: "azure",
		name: "Azure",
		cue: "机器翻译",
		note: "区域与 Azure 资源一致；全局资源可留空。",
		kind: "azure",
		recommended: false,
	}),
	Object.freeze({
		id: "deepl",
		name: "DeepL",
		cue: "机器翻译",
		note: "自动识别 Free（:fx）与 Pro 密钥。",
		kind: "deepl",
		recommended: false,
	}),
	Object.freeze({
		id: "custom",
		name: "自定义",
		cue: "OpenAI 兼容",
		note: "兼容 OpenAI Chat Completions 的代理或私有部署。",
		kind: "custom",
		recommended: false,
	}),
]);

export const SOURCES = Object.freeze([
	Object.freeze({
		id: "auto",
		name: "自动检测",
	}),
	Object.freeze({
		id: "zh",
		name: "简体中文",
	}),
	Object.freeze({
		id: "en",
		name: "English",
	}),
]);

export const TARGETS = Object.freeze([
	Object.freeze({
		id: "zh",
		name: "简体中文",
	}),
	Object.freeze({
		id: "en",
		name: "English",
	}),
]);

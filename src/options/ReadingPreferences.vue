<script setup>
import { ENGLISH_VOICES } from "../core/reading-settings.js";
import { computed, onMounted, watch } from "vue";

const reading = defineModel("reading", { type: Object, required: true });
const speech = defineModel("speech", { type: Object, required: true });
defineProps({
	busy: { type: String, default: "" },
	status: { type: Object, required: true },
	speechPreviewActive: { type: Boolean, default: false },
});
defineEmits(["save", "speak", "grant-frames"]);
const expanded = globalThis.location?.hash === "#reading";
onMounted(() => {
	if (expanded) document.getElementById("reading-preferences")?.scrollIntoView({ block: "start" });
});
const voiceChoices = computed(() => speech.value.engine === "edge" ? ENGLISH_VOICES : [
	{ id: "en-US-AriaNeural", label: "美式英语" },
	{ id: "en-GB-SoniaNeural", label: "英式英语" },
]);
watch(() => speech.value.engine, (engine) => {
	if (engine === "system") speech.value.voice = speech.value.voice.startsWith("en-GB") ? "en-GB-SoniaNeural" : "en-US-AriaNeural";
});
</script>

<template>
	<details id="reading-preferences" class="fold reading-preferences" :open="expanded">
		<summary>
			<strong>阅读与英语发音</strong>
			<span>译文样式、划词翻译与 Edge TTS</span>
		</summary>
		<div class="fold-body">
			<div class="reading-preview" :data-style="reading.style">
				<span class="preview-label">双语阅读预览</span>
				<p>Good ideas deserve to be understood.</p>
				<p class="preview-translation" :style="{ fontSize: `${16 * reading.fontScale}px`, lineHeight: reading.lineHeight }">好的想法，值得被理解。</p>
			</div>
			<fieldset class="setup-fields" :disabled="Boolean(busy)">
				<div class="behavior-grid">
					<label class="field">
						<span>译文样式</span>
						<select v-model="reading.style">
							<option value="soft">柔和底色</option>
							<option value="plain">自然段落</option>
							<option value="underline">细线标记</option>
						</select>
					</label>
					<label class="field">
						<span>译文字号 <small>{{ Math.round(reading.fontScale * 100) }}%</small></span>
						<input v-model.number="reading.fontScale" type="range" min="0.8" max="1.3" step="0.05" />
					</label>
					<label class="field">
						<span>译文行距 <small>{{ reading.lineHeight }}</small></span>
						<input v-model.number="reading.lineHeight" type="range" min="1.4" max="2.2" step="0.05" />
					</label>
					<label class="toggle-row">
						<span><strong>自动启用划词</strong><small>整页翻译后，选择文字显示快捷按钮</small></span>
						<input v-model="reading.selectionEnabled" type="checkbox" />
						<i aria-hidden="true"></i>
					</label>
					<label class="field">
						<span>英语发音</span>
						<select v-model="speech.engine">
							<option value="system">系统英语语音 · 直接使用</option>
							<option value="edge">Edge TTS · 自然语音</option>
						</select>
					</label>
					<label class="field">
						<span>{{ speech.engine === "edge" ? "声音" : "英语口音" }}</span>
						<select v-model="speech.voice">
							<option v-for="voice in voiceChoices" :key="voice.id" :value="voice.id">
								{{ voice.label }}
							</option>
						</select>
					</label>
					<label class="field">
						<span>朗读速度 <small>{{ speech.rate }}×</small></span>
						<input v-model.number="speech.rate" type="range" min="0.5" max="2" step="0.05" />
					</label>
				</div>
				<template v-if="speech.engine === 'edge'">
					<p class="reading-note">启动仓库中的 Edge TTS 本地服务，再填写下面的地址和令牌。只有点击朗读时，选中的英语才会交给语音服务。</p>
					<div class="behavior-grid">
						<label class="field"><span>Edge TTS 服务地址</span><input v-model.trim="speech.endpoint" type="url" placeholder="http://127.0.0.1:8765/tts" spellcheck="false" /></label>
						<label class="field"><span>访问令牌</span><input v-model.trim="speech.token" type="password" autocomplete="off" placeholder="本地服务启动时显示的令牌" /></label>
					</div>
				</template>
				<p v-else class="reading-note">使用系统已安装的英语声音，优先选择本机语音。划词浮层中可朗读英语原文或英语译文。</p>
			</fieldset>
			<div class="reading-actions">
				<button class="primary" type="button" :disabled="Boolean(busy)" @click="$emit('save')">{{ busy === "reading" ? "正在保存…" : "保存阅读偏好" }}</button>
				<button class="text-button" type="button" :disabled="Boolean(busy) && !speechPreviewActive" :aria-pressed="speechPreviewActive" @click="$emit('speak')">{{ speechPreviewActive ? "停止试听" : "试听英语" }}</button>
			</div>
			<p v-if="status.text" class="reading-note" :data-error="String(status.error)">{{ status.text }}</p>
			<div class="frame-access">
				<div><strong>跨域 iframe</strong><p>同源框架直接处理；来自其他网站的嵌入内容需要额外的网站访问权限，仍只在你启用翻译的标签页工作。</p></div>
				<button class="text-button" type="button" :disabled="Boolean(busy)" @click="$emit('grant-frames')">授权嵌入内容</button>
			</div>
		</div>
	</details>
</template>

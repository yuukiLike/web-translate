<script setup>
import { computed, onMounted, watch } from "vue";
import { ENGLISH_VOICES } from "../core/reading-settings.js";

const reading = defineModel("reading", { type: Object, required: true });
const speech = defineModel("speech", { type: Object, required: true });
defineProps({
	busy: { type: String, default: "" },
	dirty: { type: Boolean, default: false },
	status: { type: Object, required: true },
	speechPreviewActive: { type: Boolean, default: false },
});
defineEmits(["save", "speak"]);
const styles = [
	{ id: "soft", label: "柔和底色" },
	{ id: "plain", label: "自然段落" },
	{ id: "underline", label: "细线标记" },
];
const voiceChoices = computed(() => speech.value.engine === "edge" ? ENGLISH_VOICES : [
	{ id: "en-US-AriaNeural", label: "美式英语" },
	{ id: "en-GB-SoniaNeural", label: "英式英语" },
]);
watch(() => speech.value.engine, (engine) => {
	if (engine === "system") speech.value.voice = speech.value.voice.startsWith("en-GB") ? "en-GB-SoniaNeural" : "en-US-AriaNeural";
});
onMounted(() => {
	if (globalThis.location?.hash === "#reading") document.getElementById("reading-preferences")?.scrollIntoView({ block: "start" });
});
</script>

<template>
	<section id="reading-preferences" class="settings-panel reading-preferences" aria-labelledby="reading-title">
		<header class="section-heading">
			<div><h2 id="reading-title">阅读与发音</h2><p>调整样式，直接查看效果。</p></div>
			<span v-if="dirty" class="pending-note">未保存</span>
		</header>
		<fieldset class="setup-fields" :disabled="Boolean(busy)">
			<div class="reading-appearance">
				<div class="appearance-controls">
					<fieldset class="style-picker">
						<legend>译文样式</legend>
						<div class="segmented-control">
							<label v-for="style in styles" :key="style.id">
								<input v-model="reading.style" name="reading-style" type="radio" :value="style.id" />
								<span>{{ style.label }}</span>
							</label>
						</div>
					</fieldset>
					<label class="field range-field">
						<span>译文字号 <small>{{ Math.round(reading.fontScale * 100) }}%</small></span>
						<input v-model.number="reading.fontScale" type="range" min="0.8" max="1.3" step="0.05" />
					</label>
					<label class="field range-field">
						<span>译文行距 <small>{{ reading.lineHeight }}</small></span>
						<input v-model.number="reading.lineHeight" type="range" min="1.4" max="2.2" step="0.05" />
					</label>
				</div>
				<div class="reading-preview" :data-style="reading.style">
					<span class="preview-label">实时预览</span>
					<p>Good ideas deserve to be understood.</p>
					<p class="preview-translation" :style="{ fontSize: 16 * reading.fontScale + 'px', lineHeight: reading.lineHeight }">好的想法，值得被理解。</p>
				</div>
			</div>
			<label class="toggle-row selection-toggle">
				<span><strong>自动启用划词</strong><small>启用网页翻译后，选中文字即可翻译或朗读</small></span>
				<input v-model="reading.selectionEnabled" type="checkbox" />
				<i aria-hidden="true"></i>
			</label>
		</fieldset>

		<section class="settings-section" aria-labelledby="speech-title">
			<div class="subsection-heading">
				<h3 id="speech-title">英语发音</h3>
				<button class="secondary" type="button" :disabled="Boolean(busy) && !speechPreviewActive" :aria-pressed="speechPreviewActive"
					:aria-busy="busy === 'speech'" @click="$emit('speak')">{{ speechPreviewActive ? "停止试听" : dirty ? "保存并试听" : "试听英语" }}</button>
			</div>
			<fieldset class="setup-fields" :disabled="Boolean(busy)">
				<div class="behavior-grid">
					<label class="field">
						<span>语音来源</span>
						<select v-model="speech.engine">
							<option value="system">系统语音</option>
							<option value="edge">Edge TTS</option>
						</select>
					</label>
					<label class="field">
						<span>{{ speech.engine === "edge" ? "声音" : "英语口音" }}</span>
						<select v-model="speech.voice"><option v-for="voice in voiceChoices" :key="voice.id" :value="voice.id">{{ voice.label }}</option></select>
					</label>
				</div>
				<label class="field range-field speech-rate">
					<span>朗读速度 <small>{{ speech.rate }}×</small></span>
					<input v-model.number="speech.rate" type="range" min="0.5" max="2" step="0.05" />
				</label>
				<template v-if="speech.engine === 'edge'">
					<div class="behavior-grid edge-fields">
						<label class="field"><span>服务地址</span><input v-model.trim="speech.endpoint" type="url" placeholder="http://127.0.0.1:8765/tts" spellcheck="false" /></label>
						<label class="field"><span>访问令牌</span><input v-model.trim="speech.token" type="password" autocomplete="off" placeholder="本地服务的令牌" /></label>
					</div>
					<p class="reading-note">需要运行 Edge TTS 本地服务；只有朗读时才发送选中的英语。</p>
				</template>
				<p v-else class="reading-note">直接使用系统已安装的英语声音，优先选择本机语音。</p>
			</fieldset>
		</section>
		<footer class="panel-actions reading-actions">
			<p class="local-note">预览即时更新，保存后应用到网页。</p>
			<button class="primary" type="button" :disabled="Boolean(busy) || !dirty" :aria-busy="busy === 'reading'" @click="$emit('save')">{{ busy === "reading" ? "正在保存…" : "保存阅读偏好" }}</button>
			<output class="action-status" :data-error="String(status.error)" role="status" aria-live="polite">{{ status.scope === "reading" ? status.text : "" }}</output>
		</footer>
	</section>
</template>

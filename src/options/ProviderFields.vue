<script setup>
import { computed, ref } from "vue";

defineOptions({ name: "ProviderFields" });

const apiKey = defineModel("apiKey", { type: String, required: true });
const baseUrl = defineModel("baseUrl", { type: String, default: "" });
const model = defineModel("model", { type: String, default: "" });
const region = defineModel("region", { type: String, default: "" });
const keyVisible = ref(false);
const props = defineProps({
	models: { type: Array, default: () => [] },
	provider: { type: Object, required: true },
});
const selectedModel = computed(() => props.models.find((entry) => entry.id === model.value) || props.models[0] || null);
</script>

<template>
	<div class="provider-fields" :data-provider-fields="provider.id">
		<div class="field key-field">
			<label :for="provider.id + '-api-key'">API Key</label>
			<div class="key-input">
				<input :id="provider.id + '-api-key'" v-model="apiKey" :type="keyVisible ? 'text' : 'password'"
					autocomplete="off" :spellcheck="false" placeholder="粘贴你的 API Key" required />
				<button type="button" :aria-pressed="keyVisible" :aria-label="keyVisible ? '隐藏 API Key' : '显示 API Key'" @click="keyVisible = !keyVisible">{{ keyVisible ? "隐藏" : "显示" }}</button>
			</div>
		</div>
		<label v-if="provider.kind === 'azure'" class="field">
			<span>资源区域 <small>全局资源可留空</small></span>
			<input id="azure-region" v-model="region" autocomplete="off" placeholder="如 eastasia" />
		</label>
		<label v-if="provider.kind === 'custom'" class="field">
			<span>Base URL</span>
			<input id="custom-base-url" v-model="baseUrl" type="url" autocomplete="off" :spellcheck="false" placeholder="https://api.example.com/v1" required />
		</label>
		<label v-if="provider.kind === 'custom'" class="field">
			<span>模型 ID</span>
			<input id="custom-model" v-model="model" autocomplete="off" :spellcheck="false" placeholder="如 gpt-4o-mini" required />
		</label>
		<div v-if="provider.kind === 'model'" class="model-field">
			<label class="field" :for="provider.id + '-model'">
				<span>模型</span>
				<select :id="provider.id + '-model'" v-model="model" :data-model-provider="provider.id" :disabled="models.length === 0">
					<option v-if="models.length === 0" value="">本地目录未载入</option>
					<option v-for="entry in models" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
				</select>
			</label>
			<div v-if="selectedModel" class="model-meta" aria-live="polite">
				<span v-if="selectedModel.costText">输入 / 输出 {{ selectedModel.costText }} / 1M token</span>
				<span v-if="selectedModel.contextText">{{ selectedModel.contextText }}</span>
			</div>
		</div>
		<p class="provider-note">{{ provider.note }}</p>
	</div>
</template>

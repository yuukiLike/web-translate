<script setup>
import { computed } from "vue";

defineOptions({ name: "ProviderFields" });

const apiKey = defineModel("apiKey", { type: String, required: true });
const baseUrl = defineModel("baseUrl", { type: String, default: "" });
const model = defineModel("model", { type: String, default: "" });
const region = defineModel("region", { type: String, default: "" });

const props = defineProps({
	models: {
		type: Array,
		default: () => [],
	},
	provider: {
		type: Object,
		required: true,
	},
});

const selectedModel = computed(() => {
	return props.models.find((entry) => entry.id === model.value) || props.models[0] || null;
});
</script>

<template>
	<div class="provider-fields" :data-provider-fields="provider.id">
		<label class="field key-field">
			<span>API Key</span>
			<input
				:id="`${provider.id}-api-key`"
				v-model="apiKey"
				type="password"
				autocomplete="off"
				:spellcheck="false"
				placeholder="粘贴你的 API Key"
			/>
		</label>

		<label v-if="provider.kind === 'azure'" class="field">
			<span>资源区域 <small>全局资源可留空</small></span>
			<input id="azure-region" v-model="region" autocomplete="off" placeholder="如 eastasia" />
		</label>

		<label v-if="provider.kind === 'custom'" class="field">
			<span>Base URL</span>
			<input
				id="custom-base-url"
				v-model="baseUrl"
				type="url"
				autocomplete="off"
				:spellcheck="false"
				placeholder="https://api.example.com/v1"
			/>
		</label>

		<label v-if="provider.kind === 'custom'" class="field">
			<span>模型 ID</span>
			<input
				id="custom-model"
				v-model="model"
				autocomplete="off"
				:spellcheck="false"
				placeholder="如 gpt-4o-mini"
			/>
		</label>

		<details v-if="provider.kind === 'model'" class="model-fold">
			<summary>
				<span>模型</span>
				<strong>{{ selectedModel?.name || "本地目录未载入" }}</strong>
			</summary>
			<div class="model-body">
				<label class="field" :for="`${provider.id}-model`">选择模型</label>
				<select
					:id="`${provider.id}-model`"
					v-model="model"
					:data-model-provider="provider.id"
					:disabled="models.length === 0"
				>
					<option v-if="models.length === 0" value="">本地目录未载入</option>
					<option v-for="entry in models" :key="entry.id" :value="entry.id">
						{{ entry.optionLabel || entry.name || entry.label }}
					</option>
				</select>
				<div v-if="selectedModel" class="model-meta" aria-live="polite">
					<code>{{ selectedModel.id }}</code>
					<span v-if="selectedModel.costText">输入 / 输出 {{ selectedModel.costText }} / 1M token</span>
					<span v-if="selectedModel.contextText">{{ selectedModel.contextText }}</span>
				</div>
			</div>
		</details>

		<p class="provider-note">{{ provider.note }}</p>
	</div>
</template>

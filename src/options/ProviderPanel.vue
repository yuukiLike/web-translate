<script setup>
defineOptions({ name: "ProviderPanel" });

const apiKey = defineModel("apiKey", { type: String, required: true });
const region = defineModel("region", { type: String, default: "" });
const model = defineModel("model", { type: String, default: "" });

defineProps({
	active: {
		type: Boolean,
		required: true,
	},
	models: {
		type: Array,
		default: () => [],
	},
	provider: {
		type: Object,
		required: true,
	},
});
</script>

<template>
	<section
		v-show="active"
		class="provider-panel"
		:data-provider-panel="provider.id"
		:hidden="!active"
		:aria-label="`${provider.name} 配置`"
	>
		<div class="provider-panel-head">
			<div>
				<p class="panel-kicker">CURRENT PROVIDER</p>
				<h3>{{ provider.name }}</h3>
			</div>
			<span class="provider-type">{{ provider.kind === "model" ? "AI 模型" : "翻译 API" }}</span>
		</div>

		<div class="provider-fields" :class="{ single: provider.kind === 'deepl' }">
			<label class="field">
				<span>{{ provider.name }} API Key</span>
				<input
					:id="`${provider.id}-api-key`"
					v-model="apiKey"
					type="password"
					autocomplete="off"
					:spellcheck="false"
					placeholder="粘贴密钥"
				/>
			</label>

			<label v-if="provider.kind === 'azure'" class="field">
				<span>资源区域</span>
				<input
					id="azure-region"
					v-model="region"
					autocomplete="off"
					placeholder="例如 eastasia；全局资源可留空"
				/>
			</label>

			<label v-if="provider.kind === 'model'" class="field">
				<span>模型</span>
				<select
					:id="`${provider.id}-model`"
					v-model="model"
					:data-model-provider="provider.id"
					:disabled="models.length === 0"
				>
					<option v-if="models.length === 0" value="">本地目录未载入</option>
					<option v-for="item in models" :key="item.id" :value="item.id">
						{{ item.label }}
					</option>
				</select>
			</label>
		</div>

		<p class="provider-note">{{ provider.note }}</p>
	</section>
</template>

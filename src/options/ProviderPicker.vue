<script setup>
import { computed } from "vue";

defineOptions({ name: "ProviderPicker" });

const selected = defineModel({ type: String, required: true });
const props = defineProps({
	providers: { type: Array, required: true },
});
const currentProvider = computed(() => props.providers.find((provider) => provider.id === selected.value));
</script>

<template>
	<div class="provider-picker">
		<label class="field" for="provider">
			<span>服务</span>
			<select id="provider" v-model="selected" :aria-describedby="currentProvider?.paid ? 'provider-billing-note' : undefined">
				<option v-for="provider in providers" :key="provider.id" :value="provider.id">
					{{ provider.name }}{{ provider.paid ? " · 付费 API" : "" }}
				</option>
			</select>
		</label>
		<p v-if="currentProvider?.paid" id="provider-billing-note" class="provider-billing-note">
			API 按用量计费，实际费用以服务商账单为准。
		</p>
	</div>
</template>

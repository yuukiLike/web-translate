<script setup>
defineOptions({ name: "ProviderPicker" });

const provider = defineModel({ type: String, required: true });

defineProps({
	items: {
		type: Array,
		required: true,
	},
});
</script>

<template>
	<div id="provider" class="provider-picker" role="radiogroup" aria-label="翻译服务">
		<button
			v-for="item in items"
			:key="item.id"
			class="provider-choice"
			:class="{ selected: provider === item.id }"
			type="button"
			role="radio"
			:aria-checked="provider === item.id"
			@click="provider = item.id"
		>
			<span class="provider-dot" aria-hidden="true"></span>
			<span class="provider-copy">
				<strong>{{ item.name }}</strong>
				<small>{{ item.cue }}</small>
			</span>
			<span v-if="item.recommended" class="seed-tag">优先</span>
		</button>
	</div>
</template>

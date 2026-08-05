<script setup>
import { computed, ref, watch } from "vue";

defineOptions({ name: "ProviderPicker" });

const selected = defineModel({ type: String, required: true });
const props = defineProps({
	providers: {
		type: Array,
		required: true,
	},
});

const primaryProviders = computed(() => {
	return props.providers.filter((provider) => provider.recommended).slice(0, 3);
});
const otherProviders = computed(() => {
	const primaryIds = new Set(primaryProviders.value.map((provider) => provider.id));
	return props.providers.filter((provider) => !primaryIds.has(provider.id));
});
const selectedOtherProvider = computed(() => {
	return otherProviders.value.find((provider) => provider.id === selected.value) || null;
});
const expanded = ref(Boolean(selectedOtherProvider.value));
const moreTitle = computed(() => {
	if (expanded.value) {
		return "收起更多服务";
	}
	return selectedOtherProvider.value?.name || "更多服务";
});
const moreCue = computed(() => {
	if (expanded.value || !selectedOtherProvider.value) {
		return "Anthropic、Azure、DeepL、自定义";
	}
	return `${selectedOtherProvider.value.cue} · 当前选择`;
});

watch(selectedOtherProvider, (provider) => {
	if (provider) {
		expanded.value = true;
	}
});

function selectProvider(providerId) {
	selected.value = providerId;
}
</script>

<template>
	<fieldset id="provider" class="provider-picker">
		<legend>服务</legend>
		<div class="provider-grid">
			<label v-for="provider in primaryProviders" :key="provider.id" class="provider-choice">
				<input
					:id="`provider-${provider.id}`"
					:checked="selected === provider.id"
					name="provider"
					type="radio"
					:value="provider.id"
					@change="selectProvider(provider.id)"
				/>
				<span class="provider-card">
					<span class="provider-card-head">
						<strong>{{ provider.name }}</strong>
						<small v-if="provider.id === 'deepseek'" class="provider-default">默认</small>
					</span>
					<small>{{ provider.cue }}</small>
				</span>
			</label>

			<button
				id="provider-more"
				class="provider-more"
				type="button"
				:aria-expanded="String(expanded)"
				aria-controls="provider-more-options"
				:data-current="String(Boolean(selectedOtherProvider) && !expanded)"
				@click="expanded = !expanded"
			>
				<span class="provider-card-head">
					<strong>{{ moreTitle }}</strong>
					<i class="provider-more-arrow" aria-hidden="true"></i>
				</span>
				<small>{{ moreCue }}</small>
			</button>
		</div>

		<div v-show="expanded" id="provider-more-options" class="provider-grid provider-grid-more">
			<label v-for="provider in otherProviders" :key="provider.id" class="provider-choice">
				<input
					:id="`provider-${provider.id}`"
					:checked="selected === provider.id"
					name="provider"
					type="radio"
					:value="provider.id"
					@change="selectProvider(provider.id)"
				/>
				<span class="provider-card">
					<span class="provider-card-head"><strong>{{ provider.name }}</strong></span>
					<small>{{ provider.cue }}</small>
				</span>
			</label>
		</div>
	</fieldset>
</template>

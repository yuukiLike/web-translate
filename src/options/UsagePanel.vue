<script setup>
defineOptions({ name: "UsagePanel" });

defineProps({
	rows: {
		type: Array,
		required: true,
	},
});

defineEmits(["clear"]);
</script>

<template>
	<div id="usage-section" class="fold-body usage-section">
		<div class="usage-head">
			<p>缓存命中不会再次请求 API；模型服务按实际 token 记录。</p>
			<button id="clear-cache" class="text-button" type="button" @click="$emit('clear')">清空缓存</button>
		</div>
		<div id="usage" class="usage-list">
			<p v-if="rows.length === 0" class="empty usage-empty">本月尚无云端调用。</p>
			<article v-for="row in rows" :key="row.id" class="usage-row">
				<div class="usage-provider">
					<span class="provider-dot" aria-hidden="true"></span>
					<strong>{{ row.name }}</strong>
				</div>
				<span v-for="metric in row.metrics" :key="metric.label" class="metric">
					{{ metric.label }}
					<b>{{ metric.value }}</b>
				</span>
			</article>
		</div>
	</div>
</template>

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
	<section id="usage-section" class="workbench usage-section">
		<div class="section-head split">
			<div class="section-title">
				<span class="section-index">04</span>
				<div>
					<p class="section-kicker">GROWTH RINGS</p>
					<h2>本月用量</h2>
					<p>缓存命中不会重复调用云 API；模型服务按实际响应 token 记录。</p>
				</div>
			</div>
			<button id="clear-cache" class="text-button" type="button" @click="$emit('clear')">
				清空翻译缓存
			</button>
		</div>

		<div id="usage" class="usage-list">
			<p v-if="rows.length === 0" class="empty usage-empty">这一圈年轮还是空的，尚无云端调用记录。</p>
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
	</section>
</template>

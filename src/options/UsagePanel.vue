<script setup>
defineOptions({ name: "UsagePanel" });
defineProps({
	rows: { type: Array, required: true },
	busy: { type: String, default: "" },
	status: { type: Object, required: true },
});
defineEmits(["clear"]);
</script>

<template>
	<section id="usage-section" class="settings-panel usage-section" aria-labelledby="usage-title">
		<header class="subsection-heading usage-head">
			<h2 id="usage-title">本月用量与缓存</h2>
			<button id="clear-cache" class="text-button" type="button" :disabled="Boolean(busy)" @click="$emit('clear')">{{ busy === "cache" ? "正在清理…" : "清空缓存" }}</button>
		</header>
		<div id="usage" class="usage-list">
			<p v-if="rows.length === 0" class="empty usage-empty">本月尚无云端调用。</p>
			<article v-for="row in rows" :key="row.id" class="usage-row">
				<div class="usage-provider"><span class="provider-dot" aria-hidden="true"></span><strong>{{ row.name }}</strong></div>
				<span v-for="metric in row.metrics" :key="metric.label" class="metric">{{ metric.label }}<b>{{ metric.value }}</b></span>
			</article>
		</div>
		<p class="usage-note">缓存命中不会再次请求 API；缺失的 token 用量显示未知。</p>
		<output class="action-status" :data-error="String(status.error)" role="status" aria-live="polite">{{ status.scope === "usage" ? status.text : "" }}</output>
	</section>
</template>

<script setup>
import { nextTick, ref, watch } from "vue";
import DebugRequestDetail from "./DebugRequestDetail.vue";

defineOptions({ name: "DebugEventList" });
const props = defineProps({
	rows: { type: Array, required: true },
	requestMode: Boolean,
	follow: Boolean,
	emptyText: { type: String, default: "暂无记录。" },
});
const emit = defineEmits(["follow-change"]);
const container = ref();
const expanded = ref(new Set());

function updateExpanded(id, event) {
	const next = new Set(expanded.value);
	if (event.target.open) next.add(id);
	else next.delete(id);
	expanded.value = next;
}

function updateFollow() {
	const list = container.value;
	if (!list) return;
	emit("follow-change", list.scrollHeight - list.scrollTop - list.clientHeight <= 28);
}

watch(() => [props.rows.length, props.follow], async () => {
	if (!props.follow) return;
	await nextTick();
	if (container.value) container.value.scrollTop = container.value.scrollHeight;
});
</script>

<template>
	<div id="debug-events" ref="container" class="debug-events" role="log"
		:aria-live="follow ? 'polite' : 'off'" aria-relevant="additions" @scroll="updateFollow">
		<p v-if="rows.length === 0" class="empty">{{ emptyText }}</p>
		<details v-for="row in rows" :key="row.id" class="debug-event"
			:data-status="row.status" :data-recovery-depth="row.recoveryDepth || 0" @toggle="updateExpanded(row.id, $event)">
			<summary>
				<i class="debug-event-dot" aria-hidden="true"></i>
				<time class="debug-event-time" :datetime="row.dateTime">{{ row.time }}</time>
				<span class="debug-event-main">
					<span><strong class="debug-event-name">{{ row.name }}</strong><code>{{ row.code }}</code></span>
					<small>{{ row.summary || "展开查看调试详情" }}</small>
					<small v-if="requestMode && row.recoveryDepth">拆分恢复 · 第 {{ row.recoveryDepth }} 层</small>
				</span>
				<b>{{ row.badge }}</b>
			</summary>
			<DebugRequestDetail v-if="requestMode && expanded.has(row.id)" :request="row" />
			<dl v-else-if="!requestMode" class="debug-event-meta">
				<div v-for="field in row.fields" :key="field.key" :data-field="field.key">
					<dt>{{ field.label }}</dt><dd>{{ field.value }}</dd>
				</div>
			</dl>
		</details>
	</div>
</template>

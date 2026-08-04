<script setup>
import { nextTick, ref, watch } from "vue";

defineOptions({ name: "DebugPanel" });

const enabled = defineModel("enabled", { type: Boolean, required: true });

const props = defineProps({
	connection: {
		type: Object,
		required: true,
	},
	rows: {
		type: Array,
		required: true,
	},
});

defineEmits(["clear"]);

const eventList = ref();

watch(
	() => props.rows,
	async () => {
		await nextTick();
		if (eventList.value) {
			eventList.value.scrollTop = eventList.value.scrollHeight;
		}
	},
	{ flush: "post" },
);
</script>

<template>
	<section id="debug" class="section debug-section">
		<div class="section-head split">
			<div class="section-title">
				<span class="section-index">03</span>
				<div>
					<p class="section-kicker">GREENHOUSE</p>
					<h2>调试模式</h2>
					<p>只观察脱敏后的请求轨迹，不记录正文、密钥、请求头或响应内容。</p>
				</div>
			</div>
			<label class="switch-field">
				<span>
					<strong>记录事件</strong>
					<small>保存设置后生效</small>
				</span>
				<input id="debug-logging" v-model="enabled" type="checkbox" />
				<i aria-hidden="true"></i>
			</label>
		</div>

		<div class="code-flow" aria-label="插件请求流程">
			<code>content</code>
			<span aria-hidden="true"></span>
			<code>background</code>
			<span aria-hidden="true"></span>
			<code>provider</code>
			<span aria-hidden="true"></span>
			<code>page</code>
		</div>

		<div class="debug-help">
			<p>内容脚本筛选段落，后台读取密钥并调用服务，译文随后插入原文下方。</p>
			<p>
				<a href="docs/debugging.md" target="_blank" rel="noopener">调试指南</a>
				<a href="docs/chrome-extension-basics.md" target="_blank" rel="noopener">扩展基础</a>
			</p>
		</div>

		<div class="debug-toolbar">
			<span
				id="debug-connection"
				class="connection-state"
				:data-state="connection.state"
			>
				{{ connection.text }}
			</span>
			<button id="clear-debug-logs" class="text-button" type="button" @click="$emit('clear')">
				清空事件
			</button>
		</div>

		<div id="debug-events" ref="eventList" class="debug-events" aria-live="polite">
			<p v-if="rows.length === 0" class="empty">
				{{ enabled ? "尚无事件。翻译网页或测试连接后会在这里出现。" : "开启并保存调试模式后，这里会实时显示事件。" }}
			</p>
			<article
				v-for="row in rows"
				:key="row.id"
				class="debug-event"
				:data-status="row.status"
			>
				<time class="debug-event-time" :datetime="row.dateTime">{{ row.time }}</time>
				<strong class="debug-event-name">{{ row.name }}</strong>
				<div class="debug-event-meta">
					<span v-for="field in row.fields" :key="`${field.label}:${field.value}`">
						{{ field.label }}: {{ field.value }}
					</span>
				</div>
			</article>
		</div>
	</section>
</template>

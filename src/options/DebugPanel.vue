<script setup>
import { computed, ref, watch } from "vue";
import DebugEventList from "./DebugEventList.vue";
import DebugTraceExplorer from "./DebugTraceExplorer.vue";
import { exportDebugTrace } from "./debugTraces.js";

defineOptions({ name: "DebugPanel" });
const enabled = defineModel("enabled", { type: Boolean, required: true });
const requestPayload = defineModel("requestPayload", { type: Boolean, required: true });
const props = defineProps({
	busy: { type: String, default: "" },
	connection: { type: Object, required: true },
	requests: { type: Array, required: true },
	rows: { type: Array, required: true },
	traces: { type: Array, required: true },
	retention: { type: Object, required: true },
	status: { type: Object, required: true },
});
defineEmits(["clear", "save", "save-request-payload", "test"]);
const mode = ref("content");
const query = ref("");
const follow = ref(true);
const copyState = ref("");
const errorRows = computed(() => props.rows.filter((row) => row.status === "error"));
const modes = computed(() => [
	{ id: "content", label: "原文结构", count: props.traces.length },
	{ id: "requests", label: "HTTP 请求", count: props.requests.length },
	{ id: "events", label: "全部事件", count: props.rows.length },
	{ id: "errors", label: "错误", count: errorRows.value.length },
]);
const modeRows = computed(() => {
	if (mode.value === "content") return props.traces;
	if (mode.value === "requests") return props.requests;
	if (mode.value === "errors") return errorRows.value;
	return props.rows;
});
const visibleRows = computed(() => {
	const filter = query.value.trim().toLowerCase();
	return modeRows.value.filter((row) => row.searchText.includes(filter));
});
const emptyText = computed(() => {
	if (query.value.trim()) return "没有匹配当前筛选条件的记录。";
	if (!enabled.value) return "开启记录后，请求和事件会实时出现在这里。";
	if (mode.value === "errors") return "当前保留的记录中没有错误。";
	return "暂无记录。翻译一个网页，或测试当前服务。";
});
const latestElapsed = computed(() => {
	for (let index = props.requests.length - 1; index >= 0; index -= 1) {
		const elapsed = props.requests[index].fields.find((field) => field.key === "elapsedMs");
		if (elapsed) return elapsed.value;
	}
	return "—";
});

async function copyVisible() {
	const snapshot = mode.value === "content"
		? visibleRows.value.map((run) => exportDebugTrace(run, props.retention))
		: visibleRows.value.map((row) => ({
			timestamp: row.dateTime, event: row.code, status: row.status,
			fields: Object.fromEntries(row.fields.map((field) => [field.key, field.value])),
			...(row.capture ? { capture: row.capture } : {}),
		}));
	try {
		await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
		copyState.value = `已复制 ${snapshot.length} 条记录`;
	} catch {
		copyState.value = "复制失败，请手动选择内容";
	}
}

watch([mode, query], () => { copyState.value = ""; });
</script>

<template>
	<section id="debug" class="debug-page">
		<header class="debug-head">
			<div>
				<p class="kicker">翻译检查器</p>
				<h1>原文与请求</h1>
				<p>可另行授权记录网页原文、DOM 结构与 DeepSeek 实际请求。无痕窗口永不记录，API Key、请求头与响应体也不会记录。</p>
			</div>
			<button id="debug-test-provider" class="debug-test" type="button"
				:disabled="Boolean(busy)" @click="$emit('test')">
				{{ busy === 'test' ? '正在请求…' : '测试当前服务' }}
			</button>
		</header>
		<div class="debug-capture-controls">
			<label class="switch-field">
				<span><strong>记录事件</strong><small>请求状态、耗时与错误</small></span>
				<input id="debug-logging" v-model="enabled" type="checkbox" :disabled="Boolean(busy)" @change="$emit('save')" />
				<i aria-hidden="true"></i>
			</label>
			<label class="switch-field">
				<span><strong>原文与请求内容</strong><small>DeepSeek · 原文结构、分片与发送正文</small></span>
				<input id="debug-request-payload" v-model="requestPayload" type="checkbox"
					:disabled="!enabled || Boolean(busy)" @change="$emit('save-request-payload')" />
				<i aria-hidden="true"></i>
			</label>
			<p>先开启记录，再翻译网页。<br />关闭内容记录会清除已保存的原文和请求正文。</p>
		</div>
		<output v-if="status.text" class="debug-status" :data-error="String(status.error)" role="status" aria-live="polite">{{ status.text }}</output>
		<p v-if="retention.droppedEvents" class="trace-notice" role="status">
			保留上限已淘汰 {{ retention.droppedEvents }} 条旧事件。当前视图只包含仍保留的数据，较早任务可能不完整。
		</p>
		<div class="debug-controls">
			<div class="debug-modes" role="group" aria-label="轨迹类型">
				<button v-for="item in modes" :key="item.id" type="button" :aria-pressed="mode === item.id" @click="mode = item.id">
					{{ item.label }} <span>{{ item.count }}</span>
				</button>
			</div>
			<label class="debug-search"><span>筛选记录</span><input v-model="query" type="search"
				:placeholder="mode === 'content' ? '搜索标题、原文、DOM 路径' : '搜索模型、端点、HTTP 或错误码'" /></label>
		</div>
		<div class="debug-toolbar">
			<span id="debug-connection" class="connection-state" :data-state="connection.state">{{ connection.text }}</span>
			<div class="debug-toolbar-actions">
				<button v-if="mode !== 'content'" type="button" :aria-pressed="follow" @click="follow = !follow">{{ follow ? '跟随最新' : '继续跟随' }}</button>
				<button id="copy-debug-logs" type="button" @click="copyVisible">复制当前视图</button>
				<button id="clear-debug-logs" type="button" @click="$emit('clear')">清空</button>
			</div>
		</div>
		<DebugTraceExplorer v-if="mode === 'content'" :traces="traces" :query="query" :capture-enabled="requestPayload" :logging="enabled" />
		<DebugEventList v-else :rows="visibleRows" :request-mode="mode === 'requests'" :follow="follow" :empty-text="emptyText" @follow-change="follow = $event" />
		<footer class="debug-footer">
			<span>显示 {{ visibleRows.length }} / {{ modeRows.length }} · 最近请求 {{ latestElapsed }}</span>
			<output role="status" aria-live="polite">{{ copyState }}</output>
			<a href="https://github.com/yuukiLike/web-translate/blob/main/docs/debugging.md" target="_blank" rel="noopener">调试指南 ↗</a>
		</footer>
		<p class="debug-scope-note">原文结构记录实际选入翻译的正文块，路径对应采集时的 DOM。HTTP 状态表示请求结果，不能单独证明译文已经插入页面。</p>
	</section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";

defineOptions({ name: "DebugPanel" });

const enabled = defineModel("enabled", { type: Boolean, required: true });

const props = defineProps({
	busy: {
		type: String,
		default: "",
	},
	connection: {
		type: Object,
		required: true,
	},
	requests: {
		type: Array,
		required: true,
	},
	rows: {
		type: Array,
		required: true,
	},
	status: {
		type: Object,
		required: true,
	},
});

defineEmits(["clear", "save", "test"]);

const mode = ref("requests");
const query = ref("");
const follow = ref(true);
const copyState = ref("");
const eventList = ref();

const errorRows = computed(() => props.rows.filter((row) => row.status === "error"));
const modes = computed(() => [
	{ id: "requests", label: "请求", count: props.requests.length },
	{ id: "events", label: "全部事件", count: props.rows.length },
	{ id: "errors", label: "错误", count: errorRows.value.length },
]);
const modeRows = computed(() => {
	if (mode.value === "requests") {
		return props.requests;
	}
	if (mode.value === "errors") {
		return errorRows.value;
	}
	return props.rows;
});
const visibleRows = computed(() => {
	const filter = query.value.trim().toLowerCase();
	if (!filter) {
		return modeRows.value;
	}
	return modeRows.value.filter((row) => row.searchText.includes(filter));
});
const latestElapsed = computed(() => {
	for (let index = props.requests.length - 1; index >= 0; index -= 1) {
		const elapsed = props.requests[index].fields.find((field) => field.key === "elapsedMs");
		if (elapsed) {
			return elapsed.value;
		}
	}
	return "—";
});
const emptyText = computed(() => {
	if (query.value.trim()) {
		return "没有匹配当前筛选条件的轨迹。";
	}
	if (mode.value === "requests") {
		return enabled.value
			? "尚无 Provider 请求。点击“测试当前服务”或翻译一个网页。"
			: "开启记录后，Provider 请求会实时出现在这里。";
	}
	if (mode.value === "errors") {
		return "当前会话没有错误。";
	}
	return enabled.value ? "尚无事件。翻译或测试后会出现在这里。" : "开启记录后，这里会实时显示事件。";
});

async function scrollToLatest() {
	await nextTick();
	if (!eventList.value) {
		return;
	}
	eventList.value.scrollTop = eventList.value.scrollHeight;
}

function selectMode(nextMode) {
	mode.value = nextMode;
	follow.value = true;
}

function updateFollow() {
	if (!eventList.value) {
		return;
	}
	const remaining =
		eventList.value.scrollHeight - eventList.value.scrollTop - eventList.value.clientHeight;
	follow.value = remaining <= 28;
}

function toggleFollow() {
	follow.value = !follow.value;
	if (follow.value) {
		void scrollToLatest();
	}
}

async function copyVisible() {
	const clipboard = globalThis.navigator?.clipboard;
	if (!clipboard || typeof clipboard.writeText !== "function") {
		copyState.value = "当前浏览器无法复制";
		return;
	}
	const snapshot = visibleRows.value.map((row) => ({
		timestamp: row.dateTime,
		event: row.code,
		status: row.status,
		fields: Object.fromEntries(row.fields.map((field) => [field.key, field.value])),
	}));
	try {
		await clipboard.writeText(JSON.stringify(snapshot, null, 2));
		copyState.value = `已复制 ${snapshot.length} 条脱敏轨迹`;
	} catch {
		copyState.value = "复制失败";
	}
}

watch(
	() => [props.rows.length, props.requests.length, mode.value],
	() => {
		if (follow.value) {
			void scrollToLatest();
		}
	},
	{ flush: "post", immediate: true },
);
watch([mode, query], () => {
	copyState.value = "";
});
</script>

<template>
	<section id="debug" class="debug-page">
		<header class="debug-head">
			<div>
				<p class="kicker">开发温室</p>
				<h1>看清每一次请求。</h1>
				<p>本机实时轨迹，只保留脱敏元数据；正文、译文、密钥、请求头与响应体不会进入记录。</p>
			</div>
			<div class="debug-head-actions">
				<button
					id="debug-test-provider"
					class="debug-test"
					type="button"
					:disabled="Boolean(busy)"
					@click="$emit('test')"
				>
					{{ busy === "test" ? "正在请求…" : "测试当前服务" }}
				</button>
				<label class="switch-field">
					<span>
						<strong>记录事件</strong>
						<small>开关独立保存</small>
					</span>
					<input id="debug-logging" v-model="enabled" type="checkbox" @change="$emit('save')" />
					<i aria-hidden="true"></i>
				</label>
			</div>
		</header>

		<output
			v-if="status.text"
			class="debug-status"
			:data-error="String(status.error)"
			role="status"
			aria-live="polite"
		>
			{{ status.text }}
		</output>

		<div class="debug-path" aria-label="当前轨迹覆盖范围">
			<span>当前覆盖</span>
			<code>background</code>
			<i aria-hidden="true"></i>
			<code>cache</code>
			<i aria-hidden="true"></i>
			<code>provider</code>
			<small>网页扫描与 DOM 插入请使用网页 DevTools</small>
		</div>

		<p class="debug-help">
			<a href="https://github.com/yuukiLike/web-translate/blob/main/docs/debugging.md" target="_blank" rel="noopener">调试指南</a>
			<a href="https://github.com/yuukiLike/web-translate/blob/main/docs/chrome-extension-basics.md" target="_blank" rel="noopener">扩展基础</a>
		</p>

		<div class="debug-summary" aria-label="当前调试摘要">
			<span><small>事件</small><strong>{{ rows.length }}</strong></span>
			<span><small>请求</small><strong>{{ requests.length }}</strong></span>
			<span :data-error="String(errorRows.length > 0)"><small>错误</small><strong>{{ errorRows.length }}</strong></span>
			<span><small>最近耗时</small><strong>{{ latestElapsed }}</strong></span>
		</div>

		<div class="debug-controls">
			<div class="debug-modes" role="group" aria-label="轨迹类型">
				<button
					v-for="item in modes"
					:key="item.id"
					type="button"
					:aria-pressed="mode === item.id"
					@click="selectMode(item.id)"
				>
					{{ item.label }} <span>{{ item.count }}</span>
				</button>
			</div>
			<label class="debug-search">
				<span>筛选轨迹</span>
				<input v-model="query" type="search" placeholder="端点、模型、HTTP、错误码" />
			</label>
		</div>

		<div class="debug-toolbar">
			<span
				id="debug-connection"
				class="connection-state"
				:data-state="connection.state"
			>
				{{ connection.text }}
			</span>
			<div class="debug-toolbar-actions">
				<button type="button" :aria-pressed="follow" @click="toggleFollow">
					{{ follow ? "跟随最新" : "继续跟随" }}
				</button>
				<button id="copy-debug-logs" type="button" @click="copyVisible">复制当前视图</button>
				<button id="clear-debug-logs" type="button" @click="$emit('clear')">清空</button>
			</div>
		</div>

		<div
			id="debug-events"
			ref="eventList"
			class="debug-events"
			role="log"
			:aria-live="follow ? 'polite' : 'off'"
			aria-relevant="additions"
			@scroll="updateFollow"
		>
			<p v-if="visibleRows.length === 0" class="empty">{{ emptyText }}</p>
			<details
				v-for="row in visibleRows"
				:key="row.id"
				class="debug-event"
				:data-status="row.status"
			>
				<summary>
					<i class="debug-event-dot" aria-hidden="true"></i>
					<time class="debug-event-time" :datetime="row.dateTime">{{ row.time }}</time>
					<span class="debug-event-main">
						<span>
							<strong class="debug-event-name">{{ row.name }}</strong>
							<code>{{ row.code }}</code>
						</span>
						<small>{{ row.summary || "展开查看脱敏元数据" }}</small>
					</span>
					<b>{{ row.badge }}</b>
				</summary>
				<dl class="debug-event-meta">
					<div v-for="field in row.fields" :key="field.key" :data-field="field.key">
						<dt>{{ field.label }}</dt>
						<dd>{{ field.value }}</dd>
					</div>
				</dl>
			</details>
		</div>

		<footer class="debug-footer">
			<span>显示 {{ visibleRows.length }} / {{ modeRows.length }}</span>
			<output role="status" aria-live="polite">{{ copyState }}</output>
		</footer>
	</section>
</template>

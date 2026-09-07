<script setup>
import { computed, ref } from "vue";
import DebugEventList from "./DebugEventList.vue";
import { partIndex } from "./debugTraces.js";

defineOptions({ name: "DebugTraceExplorer" });
const props = defineProps({
	traces: { type: Array, required: true },
	query: { type: String, default: "" },
	captureEnabled: Boolean,
	logging: Boolean,
});
const selectedRunId = ref("");
const selectedNodeKey = ref("");
const copyState = ref("");
const runs = computed(() => props.traces.filter((run) => run.searchText.includes(props.query.trim().toLowerCase())));
const run = computed(() => runs.value.find((item) => item.id === selectedRunId.value) || runs.value[0]);
const node = computed(() => run.value?.nodes.find((item) => item.key === selectedNodeKey.value) || run.value?.nodes[0]);
const requests = computed(() => [...new Map(
	(node.value?.segments || []).flatMap((segment) => segment.requests).map((request) => [request.id, request]),
).values()]);
const entirelyCached = computed(() => node.value?.segments.length && node.value.segments.every((segment) =>
	segment.route === "本次页面缓存" || segment.route === "持久缓存",
));
const empty = computed(() => {
	if (!props.logging) return "先开启“记录事件”和“原文与请求内容”，再翻译一个网页。";
	if (!props.captureEnabled) return "开启“原文与请求内容”后，下一次 DeepSeek 翻译会记录原文结构和实际请求。";
	if (props.query.trim()) return "没有匹配的页面任务。可以搜索标题、原文、DOM 路径或任务 ID。";
	return "等待下一次网页翻译。新记录会自动出现；开启之前的原文无法追溯。";
});

function selectRun(id) {
	selectedRunId.value = id;
	selectedNodeKey.value = "";
	copyState.value = "";
}

function targetNode(target) {
	return run.value?.nodes.find((item) => item.id === target.nodeId && item.scanId === node.value.scanId);
}

async function copySource() {
	try {
		await navigator.clipboard.writeText(node.value.text);
		copyState.value = "原文已复制";
	} catch {
		copyState.value = "复制失败，请手动选择原文";
	}
}
</script>

<template>
	<div class="trace-explorer">
		<div v-if="!run" class="trace-empty">
			<strong>从原文，追到每一次发送。</strong>
			<p>{{ empty }}</p>
			<ol><li>选择要翻译的正文</li><li>按语言拆分与复用缓存</li><li>检查发给 DeepSeek 的实际消息</li></ol>
		</div>
		<template v-else>
			<nav class="trace-runs" aria-label="页面翻译任务">
				<button v-for="item in runs" :key="item.id" type="button"
					:aria-pressed="run.id === item.id" @click="selectRun(item.id)">
					<strong>{{ item.title || `标签页 ${item.tabId ?? '未知'}` }}</strong>
					<small>{{ item.time }} · {{ item.nodes.length }} 个原文块</small>
				</button>
			</nav>
			<div class="trace-run-heading">
				<div><h2>{{ run.title || '页面翻译任务' }}</h2><code>{{ run.url || run.id }}</code></div>
				<small>标签页 {{ run.tabId ?? '未知' }} · {{ run.scanCount }} 次扫描</small>
			</div>
			<p v-if="run.partial" class="trace-notice">这份原文记录不完整：部分内容超限，或扫描分包已不在保留窗口中。</p>
			<ol class="trace-flow" aria-label="原文到请求的数据结构">
				<li><small>原文块</small><strong>{{ run.nodes.length }}</strong></li>
				<li><small>去重后的分片</small><strong>{{ run.segments.length }}</strong></li>
				<li><small>翻译批次</small><strong>{{ run.batchCount }}</strong></li>
				<li><small>HTTP 请求</small><strong>{{ run.requests.length }}</strong></li>
			</ol>
			<p v-if="!node" class="trace-empty">
				这个任务没有保留下来的原文结构。请开启内容记录后重新翻译；已有请求可在“HTTP 请求”中查看。
			</p>
			<div v-else class="trace-workspace">
				<nav class="trace-outline" aria-label="原文结构">
					<p>原文结构 <span>{{ run.nodes.length }}</span></p>
					<button v-for="(item, index) in run.nodes" :key="item.key" type="button"
						:aria-pressed="node.key === item.key" @click="selectedNodeKey = item.key; copyState = ''">
						<span><small>{{ String(index + 1).padStart(2, '0') }}</small><code>&lt;{{ item.tag }}&gt;</code><small>{{ item.segments.length }} 分片</small></span>
						<strong>{{ item.text.slice(0, 90) || '原文未保留' }}</strong>
						<small :title="item.path">{{ item.path }}</small>
					</button>
				</nav>
				<article class="trace-detail" :aria-label="`${node.tag} 原文与请求`">
					<header class="trace-node-heading">
						<div><span class="trace-step">01 / 原文</span><h3>&lt;{{ node.tag }}&gt; <small>修订 {{ node.revision }} · {{ node.text.length }} 字符</small></h3></div>
						<button type="button" @click="copySource">复制原文</button>
					</header>
					<ol class="trace-breadcrumb" aria-label="采集时的 DOM 路径">
						<li v-for="(part, index) in node.path.split(' > ')" :key="index"><code>{{ part }}</code></li>
					</ol>
					<pre class="trace-source">{{ node.text }}</pre>
					<output class="trace-copy-status" role="status">{{ copyState }}</output>
					<header class="trace-section-heading"><span class="trace-step">02 / 翻译分片</span><small>同一分片可对应多个 DOM 位置</small></header>
					<details v-for="segment in node.segments" :key="segment.id" class="trace-segment">
						<summary>
							<span><strong>分片 {{ partIndex(segment, node.id) + 1 }}</strong><small>{{ segment.text.length }} 字符 · {{ segment.sourceLanguage }} → {{ segment.targetLanguage }}</small></span>
							<span class="trace-route">{{ segment.route }}</span>
						</summary>
						<code class="trace-segment-id">{{ segment.id }}</code>
						<p v-if="segment.id !== segment.canonicalId" class="trace-alias">与队列中的 {{ segment.canonicalId }} 共用一次翻译</p>
						<pre class="trace-source">{{ segment.text }}</pre>
						<details class="trace-target-map">
							<summary>对应 {{ segment.targets.length }} 个 DOM 位置</summary>
							<ul>
								<li v-for="target in segment.targets" :key="`${target.nodeId}:${target.partIndex}`">
									<button type="button" :disabled="!targetNode(target)" @click="selectedNodeKey = targetNode(target).key">
										<code>{{ targetNode(target)?.path || target.nodeId }}</code>
										<small>第 {{ target.partIndex + 1 }} / {{ target.partCount }} 片 · {{ targetNode(target) ? '查看原文' : '原文记录缺失' }}</small>
									</button>
								</li>
							</ul>
						</details>
						<small v-if="segment.batchIds.length" class="trace-targets">批次 <code v-for="batchId in segment.batchIds" :key="batchId">{{ batchId }}</code></small>
					</details>
					<header class="trace-section-heading"><span class="trace-step">03 / 实际发送</span><small>包含网络重试与拆分恢复产生的请求</small></header>
					<DebugEventList :rows="requests" request-mode
						:empty-text="entirelyCached ? '这些分片命中了缓存，没有发送新的模型请求。' : '暂无可关联的请求记录。可能仍在排队，或记录已超出保留窗口。'" />
				</article>
			</div>
		</template>
	</div>
</template>

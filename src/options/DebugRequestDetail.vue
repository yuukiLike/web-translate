<script setup>
import { computed, ref, watch } from "vue";
import DebugJson from "./DebugJson.vue";
import { createMessageViews, formatDebugJson, requestParameters } from "./debugPayload.js";

defineOptions({ name: "DebugRequestDetail" });
const props = defineProps({ request: { type: Object, required: true } });
const view = ref("messages");
const copyState = ref("");
const copying = ref(false);
const capture = computed(() => props.request.capture);
const messages = computed(() => createMessageViews(capture.value?.payload));
const parameters = computed(() => requestParameters(capture.value?.payload));
const metadata = computed(() => (props.request.fields || []).filter(
	({ key }) => !["requestPayload", "requestPayloadTruncated", "requestPayloadOmittedFields"].includes(key),
));
const captureLabel = computed(() => ({
	missing: "未记录正文",
	partial: "部分记录",
	complete: "已捕获请求",
})[capture.value?.status || "missing"]);
const views = [
	{ id: "messages", label: "消息与分片" },
	{ id: "parameters", label: "请求参数" },
	{ id: "json", label: "请求 JSON" },
];

function messageLabel(role) {
	if (role === "system") return "翻译指令";
	if (role === "user") return "输入内容";
	if (role === "assistant") return "助手消息";
	return "消息内容";
}

async function copyRequest() {
	if (!capture.value?.payload || copying.value) return;
	const clipboard = globalThis.navigator?.clipboard;
	if (typeof clipboard?.writeText !== "function") {
		copyState.value = "当前浏览器无法复制";
		return;
	}
	copying.value = true;
	try {
		await clipboard.writeText(formatDebugJson(capture.value.payload));
		copyState.value = capture.value.status === "partial" ? "已复制已记录部分" : "已复制请求 JSON";
	} catch {
		copyState.value = "复制失败，请稍后重试";
	} finally {
		copying.value = false;
	}
}

watch(() => props.request.id, () => {
	view.value = "messages";
	copyState.value = "";
});
</script>

<template>
	<section class="debug-request-detail" aria-label="请求详情">
		<div v-if="request.modelRequestId" class="request-lineage">
			<span>模型调用 <code>{{ request.modelRequestId }}</code></span>
			<span v-if="request.parentModelRequestId">来自 <code>{{ request.parentModelRequestId }}</code></span>
			<span v-if="request.recoveryDepth > 0">恢复层级 {{ request.recoveryDepth }}</span>
			<span v-if="request.attempt > 0">尝试 {{ request.attempt }}</span>
		</div>
		<details v-if="metadata.length" class="request-context">
			<summary>请求上下文 <small>{{ metadata.length }} 项 · 批次、耗时与关联信息</small></summary>
			<dl class="request-metadata">
				<div v-for="field in metadata" :key="field.key" :data-field="field.key">
					<dt>{{ field.label }}</dt>
					<dd>{{ field.value }}</dd>
				</div>
			</dl>
		</details>
		<header class="request-capture-head">
			<div>
				<h3>发送给模型的内容</h3>
				<span class="capture-state" :data-state="capture?.status || 'missing'">{{ captureLabel }}</span>
			</div>
			<button class="request-copy" type="button" :disabled="!capture?.payload || copying" @click="copyRequest">
				{{ copying ? "正在复制…" : "复制请求 JSON" }}
			</button>
		</header>
		<p v-if="!capture?.payload" class="capture-notice">
			这次请求没有保存正文。开启“原文与请求内容”后重新翻译，后续请求会在这里展示；已有记录无法补回正文。
		</p>
		<template v-else>
			<div v-if="capture.status === 'partial'" class="capture-notice" data-partial="true">
				<p>这份请求快照不完整，以下展示已记录的部分。</p>
				<p v-if="capture.truncated">正文超过记录上限或包含被截短的内容。</p>
				<p v-if="capture.omittedFields.length">未记录字段：<code>{{ capture.omittedFields.join('、') }}</code></p>
			</div>
			<p v-else class="capture-origin">来自 HTTP 发送时捕获的正文；请求头和 API Key 不记录。</p>
			<div class="request-view-controls" role="group" aria-label="请求正文视图">
				<button v-for="item in views" :key="item.id" type="button" :aria-pressed="view === item.id" @click="view = item.id">
					{{ item.label }}<small v-if="item.id === 'messages'">{{ messages.length }}</small>
				</button>
			</div>
			<div v-if="view === 'messages'" class="request-messages">
				<p v-if="messages.length === 0" class="capture-notice">已记录的请求正文不包含 messages。</p>
				<article v-for="message in messages" :key="message.index" class="request-message">
					<header>
						<strong class="message-role">{{ message.role }}</strong>
						<span>{{ messageLabel(message.role) }}</span>
						<code>messages[{{ message.index }}]</code>
					</header>
					<template v-if="message.role === 'user' && message.parsed.translation">
						<div class="request-segment-head">
							<span>{{ message.parsed.translation.sourceLanguage }} <i aria-hidden="true">→</i> {{ message.parsed.translation.targetLanguage }}</span>
							<strong>{{ message.parsed.translation.segments.length }} 个分片</strong>
						</div>
						<div class="request-segments">
							<details v-for="(segment, index) in message.parsed.translation.segments" :key="index" class="request-segment" :open="message.parsed.translation.segments.length < 5">
								<summary><code>{{ segment.id }}</code><small>{{ segment.text.length }} 字符</small></summary>
								<pre class="request-text">{{ segment.text }}</pre>
							</details>
						</div>
						<details class="request-raw-message">
							<summary>这条消息的原始文本</summary>
							<pre class="request-text">{{ message.content }}</pre>
						</details>
					</template>
					<DebugJson v-else-if="message.parsed.format === 'json'" :value="message.parsed.value" />
					<pre v-else class="request-text">{{ message.content }}</pre>
				</article>
			</div>
			<DebugJson v-else-if="view === 'parameters'" :value="parameters" />
			<DebugJson v-else :value="capture.payload" />
		</template>
		<output class="request-copy-state" role="status" aria-live="polite">{{ copyState }}</output>
	</section>
</template>

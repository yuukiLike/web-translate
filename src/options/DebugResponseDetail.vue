<script setup>
import { computed, ref, watch } from "vue";
import DebugJson from "./DebugJson.vue";
import { createResponseMessageViews, formatDebugJson } from "./debugPayload.js";

defineOptions({ name: "DebugResponseDetail" });
const props = defineProps({ request: { type: Object, required: true } });
const view = ref("translations");
const copyState = ref("");
const copying = ref(false);
const capture = computed(() => props.request.responseCapture);
const messages = computed(() => createResponseMessageViews(capture.value?.payload));
const label = computed(() => ({
	missing: props.request.status === "pending" ? "等待响应" : "未记录响应",
	partial: "部分记录", complete: "已捕获响应",
})[capture.value?.status || "missing"]);

async function copyResponse() {
	if (!capture.value?.payload || copying.value) return;
	const clipboard = globalThis.navigator?.clipboard;
	if (typeof clipboard?.writeText !== "function") {
		copyState.value = "当前浏览器无法复制";
		return;
	}
	copying.value = true;
	try {
		await clipboard.writeText(formatDebugJson(capture.value.payload));
		copyState.value = capture.value.status === "partial" ? "已复制已记录部分" : "已复制响应 JSON";
	} catch {
		copyState.value = "复制失败，请稍后重试";
	} finally {
		copying.value = false;
	}
}

watch(() => props.request.id, () => {
	view.value = "translations";
	copyState.value = "";
});
watch(() => capture.value?.payload, () => { copyState.value = ""; });
</script>

<template>
	<section class="debug-response-detail" aria-label="响应详情">
		<header class="request-capture-head">
			<div>
				<h3>模型返回的内容</h3>
				<span class="capture-state" :data-state="capture?.status || 'missing'">{{ label }}</span>
			</div>
			<button class="request-copy response-copy" type="button" :disabled="!capture?.payload || copying" @click="copyResponse">
				{{ copying ? "正在复制…" : "复制响应 JSON" }}
			</button>
		</header>
		<p v-if="!capture?.payload" class="capture-notice response-notice">
			{{ request.status === 'pending' ? '请求仍在处理中。' : '这次请求没有保存可展示的响应正文。开启“原文、请求与响应”后重新翻译；已有记录无法补回响应。' }}
		</p>
		<template v-else>
			<div v-if="capture.status === 'partial'" class="capture-notice" data-partial="true">
				<p>这份响应快照不完整，以下展示已记录的部分。</p>
				<p v-if="capture.truncated">响应超过记录上限或包含被截短的内容。</p>
				<p v-if="capture.omittedFields.length">未记录字段：<code>{{ capture.omittedFields.join('、') }}</code></p>
			</div>
			<p class="capture-origin">来自 SDK 保留的 HTTP 响应正文。分片视图解析 choices[].message.content；是否通过翻译校验请看请求状态。</p>
			<div class="request-view-controls response-view-controls" role="group" aria-label="响应正文视图">
				<button type="button" :aria-pressed="view === 'translations'" @click="view = 'translations'">返回内容与分片</button>
				<button type="button" :aria-pressed="view === 'json'" @click="view = 'json'">响应 JSON</button>
			</div>
			<div v-if="view === 'translations' && messages.length" class="request-messages response-messages">
				<article v-for="message in messages" :key="message.index" class="request-message">
					<header>
						<strong class="message-role">{{ message.role }}</strong>
						<span>{{ message.finishReason || '未提供结束原因' }}</span>
						<code>choices[{{ message.index }}]</code>
					</header>
					<div v-if="message.translations" class="request-segments response-segments">
						<details v-for="(segment, index) in message.translations" :key="index" class="request-segment" :open="message.translations.length < 5">
							<summary><code>{{ segment.id }}</code><small>{{ segment.text.length }} 字符</small></summary>
							<pre class="request-text">{{ segment.text }}</pre>
						</details>
					</div>
					<p v-else class="capture-notice">返回内容无法解析为 translations 分片，以下保留已记录的文本。</p>
					<details class="request-raw-message" :open="!message.translations">
						<summary>模型返回的原始文本</summary>
						<pre class="request-text">{{ message.content }}</pre>
					</details>
				</article>
			</div>
			<DebugJson v-else :value="capture.payload" />
		</template>
		<output class="request-copy-state" role="status" aria-live="polite">{{ copyState }}</output>
	</section>
</template>

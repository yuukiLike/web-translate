<script setup>
import { computed } from "vue";
import { formatDebugJson } from "./debugPayload.js";

defineOptions({ name: "DebugJson" });
const props = defineProps({ value: { required: true } });
const lines = computed(() => formatDebugJson(props.value).split("\n"));
</script>

<template>
	<div class="debug-json" tabindex="0" role="region" aria-label="格式化 JSON，可滚动查看">
		<pre><code v-for="(line, index) in lines" :key="index" class="debug-json-line"><span class="debug-json-number" aria-hidden="true">{{ index + 1 }}</span><span>{{ line }}</span></code></pre>
	</div>
</template>

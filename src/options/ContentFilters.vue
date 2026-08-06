<script setup>
import { watch } from "vue";

defineOptions({ name: "ContentFilters" });

const props = defineProps({
	modelValue: { type: Object, required: true },
});
const emit = defineEmits(["update:modelValue"]);
let latestModelValue = props.modelValue;

watch(
	() => props.modelValue,
	(value) => {
		latestModelValue = value;
	},
	{ flush: "sync" },
);

const FILTER_OPTIONS = Object.freeze([
	Object.freeze({
		key: "skipTechnicalIdentifiers",
		id: "filter-technical-identifiers",
		label: "跳过技术标识",
		description: "仓库名、文件路径、版本号和提交哈希",
	}),
	Object.freeze({
		key: "skipSocialMetadata",
		id: "filter-social-metadata",
		label: "跳过社交元数据",
		description: "账号、作者、发布时间等独立元数据",
	}),
	Object.freeze({
		key: "skipShortLinks",
		id: "filter-short-links",
		label: "跳过短链接",
		description: "过滤 3 个以内（含 3 个）英文单词的链接",
	}),
]);

function updateFilter(key, enabled) {
	latestModelValue = {
		...latestModelValue,
		[key]: enabled,
	};
	emit("update:modelValue", latestModelValue);
}
</script>

<template>
	<details id="content-filters" class="fold">
		<summary>
			<strong>内容过滤</strong>
			<span>纯数字、计数、常用技术词与界面标签始终跳过</span>
		</summary>
		<div class="fold-body behavior-grid">
			<label v-for="filter in FILTER_OPTIONS" :key="filter.key" class="toggle-row">
				<span>
					<strong>{{ filter.label }}</strong>
					<small>{{ filter.description }}</small>
				</span>
				<input
					:id="filter.id"
					:checked="modelValue[filter.key]"
					type="checkbox"
					@change="updateFilter(filter.key, $event.target.checked)"
				/>
				<i aria-hidden="true"></i>
			</label>
		</div>
	</details>
</template>

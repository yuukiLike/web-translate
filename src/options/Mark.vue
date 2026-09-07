<script setup>
defineOptions({ name: "BrandMark" });
// Resolve from the packaged Options page, not this source component.
const iconUrl = "../assets/icons/icon.svg";
</script>

<template>
	<img class="mark" :src="iconUrl" width="64" height="64" alt="" aria-hidden="true" />
</template>

<script setup>
defineOptions({ name: "BrandMark" });
</script>

<template>
	<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
		<path class="mark-leaf mark-leaf-left" d="M27 23C17 23 11 17 12 8c9-1 15 5 15 15Z" />
		<path class="mark-leaf mark-leaf-right" d="M29 18C30 9 35 5 44 6c0 9-5 13-15 12Z" />
		<rect class="mark-stem" x="25" y="17" width="6" height="34" rx="3" />
		<rect class="mark-sign" x="31" y="33" width="27" height="25" rx="6" />
		<path
			class="mark-sign-fill"
			fill-rule="evenodd"
			d="M37.2 52h-2.8l4.6-13h3l4.6 13h-2.9l-.9-2.8h-4.7l-.9 2.8Zm1.7-5.2H42l-1.55-4.7-1.55 4.7Z"
		/>
		<rect class="mark-sign-fill" x="49" y="39" width="3" height="2" rx="1" />
		<rect class="mark-sign-fill" x="46.5" y="42.5" width="8.5" height="2" rx="1" />
		<path
			class="mark-sign-stroke"
			d="M48 45.5c.9 2.4 3 4.7 6.3 6.3M53.5 45.5c-.9 2.5-3 4.8-6.2 6.4"
		/>
	</svg>
</template>

<script setup>
import { ref } from "vue";

import ContentFilters from "./ContentFilters.vue";
import DebugPanel from "./DebugPanel.vue";
import Mark from "./Mark.vue";
import ProviderFields from "./ProviderFields.vue";
import ProviderPicker from "./ProviderPicker.vue";
import ReadingPreferences from "./ReadingPreferences.vue";
import UsagePanel from "./UsagePanel.vue";
import { useOptions } from "./useOptions.js";

defineOptions({ name: "OptionsApp" });

const view = ref(globalThis.location?.hash === "#debug" ? "debug" : "setup");
const {
	busy,
	catalogInfo,
	clearCache,
	connected,
	debug,
	draft,
	fatal,
	providers,
	ready,
	readingDirty,
	reloadRequired,
	saveDebug,
	saveDebugRequestPayload,
	selectedProvider,
	setSourceMode,
	setTargetMode,
	sources,
	status,
	targets,
	testProvider,
	saveReading,
	previewSpeech,
	speechPreviewActive,
	grantFrames,
	usageRows,
	version,
} = useOptions();
const {
	clear: clearDebug,
	connection: debugConnection,
	requests: debugRequests,
	rows: debugRows,
	traces: debugTraces,
	retention: debugRetention,
} = debug;

function show(nextView) {
	view.value = nextView;
	const hash = nextView === "debug" ? "#debug" : "#setup";
	globalThis.history?.replaceState(null, "", hash);
	if (globalThis.location?.hash !== hash) globalThis.location.hash = hash;
}

function getSubmitLabel() {
	if (busy.value === "test") return "正在检查连接…";
	if (reloadRequired.value) return "重新载入扩展";
	return connected.value ? "保存并重新检查" : "保存并检查连接";
}

function swapLanguages() {
	if (busy.value || draft.sourceMode === "auto") return;
	const previousSource = draft.sourceMode;
	setSourceMode(draft.targetMode);
	setTargetMode(previousSource);
}

function reloadOptions() { globalThis.location.reload(); }
</script>

<template>
	<div class="shell">
		<header class="topbar">
			<button class="brand" type="button" aria-label="打开翻译配置" @click="show('setup')">
				<span class="mark-wrap"><Mark /></span>
				<strong>一键双语</strong>
			</button>
			<nav class="tabs" aria-label="设置页导航">
				<button type="button" :aria-pressed="view === 'setup'" @click="show('setup')">设置</button>
				<button type="button" :aria-pressed="view === 'debug'" @click="show('debug')">
					调试<i v-if="draft.debugLogging" aria-label="已开启"></i>
				</button>
			</nav>
			<code id="extension-version" class="version">{{ version }}</code>
		</header>

		<main>
			<section v-if="fatal" class="fatal" role="alert">
				<Mark />
				<div>
					<h1>设置页未能加载</h1>
					<p>{{ fatal }}</p>
					<button class="text-button" type="button" @click="reloadOptions">重新加载</button>
				</div>
			</section>
			<div v-else-if="!ready" class="boot" role="status" aria-live="polite" aria-busy="true">
				<span class="loading-indicator" aria-hidden="true"></span>
				<p>正在读取本地设置…</p>
			</div>

			<template v-else-if="view === 'setup'">
				<div class="settings-layout">
					<form id="settings-form" class="settings-panel service-panel" @submit.prevent="testProvider">
						<header class="section-heading">
							<div><h1>翻译服务</h1><p>连接服务，选择翻译方向。</p></div>
							<span v-if="connected" class="connected"><span aria-hidden="true">✓</span>连接可用</span>
						</header>
						<fieldset class="setup-fields" :disabled="Boolean(busy)">
							<ProviderPicker v-model="draft.provider" :providers="providers" />
							<ProviderFields
								:key="selectedProvider.id"
								v-model:api-key="draft[selectedProvider.id].apiKey"
								v-model:base-url="draft.custom.baseUrl"
								v-model:model="draft[selectedProvider.id].model"
								v-model:region="draft.azure.region"
								:models="catalogInfo.models[selectedProvider.id]"
								:provider="selectedProvider"
							/>
							<section id="behavior" class="settings-section" aria-labelledby="direction-title">
								<h2 id="direction-title">翻译方向</h2>
								<div class="language-pair">
									<label class="field">
										<span>输入语言</span>
										<select id="source-mode" :value="draft.sourceMode" @change="setSourceMode($event.target.value)">
											<option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
										</select>
									</label>
									<button class="direction-swap" type="button" aria-label="交换输入与输出语言"
										:disabled="draft.sourceMode === 'auto'" :title="draft.sourceMode === 'auto' ? '自动检测时无法交换' : '交换翻译方向'" @click="swapLanguages">
										<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
									</button>
									<label class="field">
										<span>输出语言</span>
										<select id="target-mode" :value="draft.targetMode" @change="setTargetMode($event.target.value)">
											<option v-for="target in targets" :key="target.id" :value="target.id">{{ target.name }}</option>
										</select>
									</label>
								</div>
							</section>
							<section class="settings-section" aria-labelledby="page-title">
								<h2 id="page-title">页面处理</h2>
								<label class="toggle-row">
									<span><strong>增量翻译</strong><small>自动跟随滚动和页面新增内容</small></span>
									<input id="translate-dynamic" v-model="draft.translateDynamicContent" type="checkbox" />
									<i aria-hidden="true"></i>
								</label>
								<label class="field concurrency-field">
									<span>并行请求 <small>1–4 个</small></span>
									<input id="concurrency" v-model.number="draft.concurrency" type="number" min="1" max="4" step="1" />
								</label>
								<ContentFilters v-model="draft.contentFilters" />
							</section>
						</fieldset>
						<footer class="panel-actions">
							<p class="local-note">密钥仅存本机；正文只发送给 {{ selectedProvider.name }}。</p>
							<button id="test-provider" class="primary" type="submit" :disabled="Boolean(busy)" :aria-busy="busy === 'test'" :formnovalidate="reloadRequired">{{ getSubmitLabel() }}</button>
							<output id="status" class="action-status" :data-error="String(status.error)" role="status" aria-live="polite">{{ status.scope === "service" ? status.text : "" }}</output>
						</footer>
					</form>

					<div class="settings-stack">
						<ReadingPreferences
							v-model:reading="draft.reading"
							v-model:speech="draft.speech"
							:busy="busy"
							:dirty="readingDirty"
							:status="status"
							:speech-preview-active="speechPreviewActive"
							@save="saveReading"
							@speak="previewSpeech"
						/>
						<section class="settings-panel frame-panel" aria-labelledby="frames-title">
							<div class="frame-access">
								<div><h2 id="frames-title">嵌入网页</h2><p>需要翻译其他网站嵌入的内容时，再授予访问权限。</p></div>
								<button class="secondary" type="button" :disabled="Boolean(busy)" :aria-busy="busy === 'permission'" @click="grantFrames">{{ busy === "permission" ? "正在申请…" : "授权访问" }}</button>
							</div>
							<output class="action-status" :data-error="String(status.error)" role="status" aria-live="polite">{{ status.scope === "frames" ? status.text : "" }}</output>
						</section>
						<UsagePanel :rows="usageRows" :busy="busy" :status="status" @clear="clearCache" />
					</div>
				</div>
				<footer id="privacy" class="privacy"><p>只在启用翻译、划词或朗读时读取网页。密钥与语音令牌仅存本机。</p></footer>
			</template>

			<DebugPanel
				v-else
				v-model:enabled="draft.debugLogging"
				v-model:request-payload="draft.debugRequestPayload"
				:busy="busy"
				:connection="debugConnection"
				:requests="debugRequests"
				:rows="debugRows"
				:traces="debugTraces"
				:retention="debugRetention"
				:status="status"
				@clear="clearDebug"
				@save="saveDebug"
				@save-request-payload="saveDebugRequestPayload"
				@test="testProvider"
			/>
		</main>
	</div>
</template>

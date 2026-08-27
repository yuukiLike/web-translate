<script setup>
import { ref } from "vue";

import ContentFilters from "./ContentFilters.vue";
import DebugPanel from "./DebugPanel.vue";
import Mark from "./Mark.vue";
import ProviderFields from "./ProviderFields.vue";
import ProviderPicker from "./ProviderPicker.vue";
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
	reloadRequired,
	saveDebug,
	saveDebugRequestPayload,
	selectedProvider,
	selectedSource,
	selectedTarget,
	setSourceMode,
	setTargetMode,
	sources,
	status,
	targets,
	testProvider,
	usageRows,
	version,
} = useOptions();

const {
	clear: clearDebug,
	connection: debugConnection,
	requests: debugRequests,
	rows: debugRows,
} = debug;

function show(nextView) {
	view.value = nextView;
	const hash = nextView === "debug" ? "#debug" : "#setup";
	globalThis.history?.replaceState(null, "", hash);
	if (globalThis.location?.hash !== hash) {
		globalThis.location.hash = hash;
	}
}

function getSubmitLabel() {
	if (busy.value === "test") return "正在连接…";
	if (reloadRequired.value) return "重新载入扩展";
	return connected.value ? "重新测试" : "保存并测试";
}
</script>

<template>
	<div class="shell">
		<header class="topbar">
			<button class="brand" type="button" aria-label="打开翻译配置" @click="show('setup')">
				<span class="mark-wrap"><Mark /></span>
				<span class="brand-copy">
					<strong>一键双语</strong>
					<small>web translate</small>
				</span>
			</button>

			<nav class="tabs" aria-label="设置页导航">
				<button type="button" :aria-pressed="view === 'setup'" @click="show('setup')">配置</button>
				<button type="button" :aria-pressed="view === 'debug'" @click="show('debug')">
					调试
					<i v-if="draft.debugLogging" aria-label="已开启"></i>
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
				</div>
			</section>

			<div v-else-if="!ready" class="boot" role="status" aria-live="polite">
				<Mark />
				<p>正在读取本地设置…</p>
			</div>

			<template v-else-if="view === 'setup'">
				<section class="intro">
					<div>
						<p class="kicker">一次配置，以后只点图标</p>
						<h1>让译文自然长在原文下面。</h1>
						<p>粘贴 API Key，扩展会翻译整页，并继续处理下滑时出现的新内容。</p>
					</div>
					<div class="bilingual-sample" aria-hidden="true">
						<span>Keep reading the page.</span>
						<strong>继续阅读整个网页。</strong>
					</div>
				</section>

				<form id="settings-form" class="setup" @submit.prevent="testProvider">
					<div class="setup-head">
						<div>
							<p class="step">连接翻译服务</p>
							<h2>一个 Key，一次点击。</h2>
						</div>
						<span v-if="connected" class="connected"><i aria-hidden="true"></i>连接可用</span>
					</div>

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

					<div class="submit-row">
						<button id="test-provider" class="primary" type="submit" :disabled="Boolean(busy)">
							{{ getSubmitLabel() }}
						</button>
						<output id="status" :data-error="String(status.error)" role="status" aria-live="polite">
							{{ status.text }}
						</output>
					</div>

					<p class="local-note">
						<span aria-hidden="true"></span>
						密钥仅存本机；正文只发送给 {{ selectedProvider.name }}。
					</p>

					<details id="behavior" class="fold">
						<summary>
							<strong>翻译方式</strong>
							<span>{{ selectedSource.name }} → {{ selectedTarget.name }} · {{ draft.translateDynamicContent ? "持续翻译" : "单次扫描" }} · 并发 {{ draft.concurrency }}</span>
						</summary>
						<div class="fold-body behavior-grid">
							<label class="field">
								<span>输入语言</span>
								<select id="source-mode" :value="draft.sourceMode" @change="setSourceMode($event.target.value)">
									<option v-for="source in sources" :key="source.id" :value="source.id">
										{{ source.name }}
									</option>
								</select>
							</label>
							<label class="field">
								<span>输出语言</span>
								<select id="target-mode" :value="draft.targetMode" @change="setTargetMode($event.target.value)">
									<option v-for="target in targets" :key="target.id" :value="target.id">
										{{ target.name }}
									</option>
								</select>
							</label>
							<label class="field">
								<span>云端并发</span>
								<input id="concurrency" v-model.number="draft.concurrency" type="number" min="1" max="4" step="1" />
							</label>
							<label class="toggle-row">
								<span><strong>增量翻译</strong><small>无限滚动、SPA 与懒加载</small></span>
								<input id="translate-dynamic" v-model="draft.translateDynamicContent" type="checkbox" />
								<i aria-hidden="true"></i>
							</label>
						</div>
					</details>

					<ContentFilters v-model="draft.contentFilters" />

					<details class="fold catalog-fold">
						<summary>
							<strong>模型目录</strong>
							<span>固定快照，不在运行时联网更新</span>
						</summary>
						<p
							id="catalog-status"
							class="catalog-status"
							:data-error="String(Boolean(catalogInfo.error))"
							role="status"
						>
							<template v-if="catalogInfo.error">{{ catalogInfo.error }}</template>
							<template v-else>
								Snapshot <code id="catalog-source-sha">{{ catalogInfo.sha }}</code>
								·
								<time id="catalog-fetched-at" :datetime="catalogInfo.dateTime">{{ catalogInfo.dateText }}</time>
							</template>
						</p>
					</details>

					<details class="fold">
						<summary>
							<strong>本月用量与缓存</strong>
							<span>{{ usageRows.length ? `${usageRows.length} 个服务有记录` : "暂无云端调用" }}</span>
						</summary>
						<UsagePanel :rows="usageRows" @clear="clearCache" />
					</details>
				</form>

				<footer id="privacy" class="privacy">
					<Mark />
					<p>
						扩展只在点击图标后读取当前标签页。API Key 存于 <code>chrome.storage.local</code>，网页脚本无法读取。
					</p>
				</footer>
			</template>

			<DebugPanel
				v-else
					v-model:enabled="draft.debugLogging"
					v-model:request-payload="draft.debugRequestPayload"
				:busy="busy"
				:connection="debugConnection"
				:requests="debugRequests"
				:rows="debugRows"
				:status="status"
				@clear="clearDebug"
					@save="saveDebug"
					@save-request-payload="saveDebugRequestPayload"
				@test="testProvider"
			/>
		</main>
	</div>
</template>

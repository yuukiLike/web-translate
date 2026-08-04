<script setup>
import DebugPanel from "./DebugPanel.vue";
import Mark from "./Mark.vue";
import ProviderPanel from "./ProviderPanel.vue";
import ProviderPicker from "./ProviderPicker.vue";
import UsagePanel from "./UsagePanel.vue";
import { useOptions } from "./useOptions.js";

defineOptions({ name: "OptionsApp" });

const nav = [
	{ href: "#service", index: "01", name: "接入服务", note: "ROOTS" },
	{ href: "#behavior", index: "02", name: "翻译习惯", note: "GROWTH" },
	{ href: "#debug", index: "03", name: "调试模式", note: "GREENHOUSE" },
	{ href: "#usage-section", index: "04", name: "本月用量", note: "RINGS" },
	{ href: "#privacy", index: "05", name: "隐私边界", note: "GROUND" },
];

const {
	busy,
	catalogInfo,
	clearCache,
	debug,
	draft,
	fatal,
	providers,
	ready,
	save,
	selectedProvider,
	selectedTarget,
	status,
	targets,
	testProvider,
	usageRows,
	version,
} = useOptions();

const {
	clear: clearDebug,
	connection: debugConnection,
	rows: debugRows,
} = debug;
</script>

<template>
	<div class="page">
		<svg class="growth-rings" viewBox="0 0 540 540" aria-hidden="true">
			<circle cx="270" cy="270" r="76" />
			<circle cx="270" cy="270" r="116" />
			<circle cx="270" cy="270" r="158" />
			<circle cx="270" cy="270" r="202" />
			<circle cx="270" cy="270" r="246" />
		</svg>

		<aside class="rail">
			<a class="brand" href="#top" aria-label="回到页面顶部">
				<span class="mark-wrap"><Mark /></span>
				<span>
					<strong>web translate</strong>
					<small>first sapling</small>
				</span>
			</a>

			<nav class="rail-nav" aria-label="设置页导航">
				<a v-for="item in nav" :key="item.href" :href="item.href">
					<span>{{ item.index }}</span>
					<strong>{{ item.name }}</strong>
					<small>{{ item.note }}</small>
				</a>
			</nav>

			<div class="rail-meta">
				<p><i aria-hidden="true"></i> 本地优先</p>
				<code id="extension-version">{{ version }}</code>
			</div>
		</aside>

		<main id="top" class="main">
			<header class="hero">
				<div class="hero-copy">
					<p class="eyebrow"><span aria-hidden="true"></span> YOUR FIRST OPEN-SOURCE SAPLING</p>
					<h1>让译文，<em>自然长在</em><br />原文下方。</h1>
					<p class="lede">点击一次扩展图标，整页内容和后续加载的段落都会持续长出双语译文。</p>
				</div>

				<section v-if="ready && !fatal" class="glance" aria-label="当前翻译状态">
					<p class="glance-title">CURRENT GROVE</p>
					<dl>
						<div>
							<dt>服务</dt>
							<dd><i aria-hidden="true"></i>{{ selectedProvider.name }}</dd>
						</div>
						<div>
							<dt>方向</dt>
							<dd>{{ selectedTarget.cue }}</dd>
						</div>
						<div>
							<dt>新内容</dt>
							<dd>{{ draft.translateDynamicContent ? "持续监听" : "单次扫描" }}</dd>
						</div>
						<div>
							<dt>目录</dt>
							<dd>{{ catalogInfo.error ? "需要重建" : catalogInfo.sha }}</dd>
						</div>
					</dl>
					<div class="growth-meter" aria-hidden="true">
						<span v-for="index in 12" :key="index" :class="{ active: index < 10 }"></span>
					</div>
				</section>
			</header>

			<section v-if="fatal" class="fatal" role="alert">
				<Mark />
				<div>
					<p class="section-kicker">SETUP PAUSED</p>
					<h2>设置页没有完整发芽</h2>
					<p>{{ fatal }}</p>
				</div>
			</section>

			<div v-else-if="!ready" class="boot" role="status" aria-live="polite">
				<span class="boot-stem" aria-hidden="true"></span>
				<p>正在读取本地设置…</p>
			</div>

			<template v-else>
				<form id="settings-form" class="workbench" @submit.prevent="save">
					<section id="service" class="section service-section">
						<div class="section-head">
							<div class="section-title">
								<span class="section-index">01</span>
								<div>
									<p class="section-kicker">ROOTS</p>
									<h2>接入翻译服务</h2>
									<p>只发送筛选后的正文段落；网址、Cookie、输入框和整页 HTML 不会离开浏览器。</p>
								</div>
							</div>
						</div>

						<ProviderPicker v-model="draft.provider" :items="providers" />

						<div class="provider-stage">
							<ProviderPanel
								v-for="item in providers"
								:key="item.id"
								v-model:api-key="draft[item.id].apiKey"
								v-model:model="draft[item.id].model"
								v-model:region="draft.azure.region"
								:active="draft.provider === item.id"
								:models="catalogInfo.models[item.id] || []"
								:provider="item"
							/>
						</div>

						<p
							id="catalog-status"
							class="catalog-status"
							:data-error="String(Boolean(catalogInfo.error))"
							role="status"
							aria-live="polite"
						>
							<span class="catalog-mark" aria-hidden="true"></span>
							<template v-if="catalogInfo.error">{{ catalogInfo.error }}</template>
							<template v-else>
								固定本地目录 <code id="catalog-source-sha">{{ catalogInfo.sha }}</code>
								<span aria-hidden="true">·</span>
								<time id="catalog-fetched-at" :datetime="catalogInfo.dateTime" :title="catalogInfo.dateTime">
									{{ catalogInfo.dateText }}
								</time>
								<span aria-hidden="true">·</span> 更新后需重新加载扩展
							</template>
						</p>
					</section>

					<section id="behavior" class="section behavior-section">
						<div class="section-head">
							<div class="section-title">
								<span class="section-index">02</span>
								<div>
									<p class="section-kicker">GROWTH</p>
									<h2>翻译习惯</h2>
									<p>设置语言方向、请求节奏，以及下滑时是否继续翻译新段落。</p>
								</div>
							</div>
						</div>

						<div class="behavior-grid">
							<label class="field behavior-target">
								<span>中英方向</span>
								<select id="target-mode" v-model="draft.targetMode">
									<option v-for="item in targets" :key="item.id" :value="item.id">
										{{ item.name }}
									</option>
								</select>
							</label>

							<label class="field behavior-speed">
								<span>云端并发</span>
								<input id="concurrency" v-model.number="draft.concurrency" type="number" min="1" max="4" step="1" />
							</label>

							<label class="toggle-row">
								<span>
									<strong>增量翻译</strong>
									<small>继续处理 SPA、无限滚动和懒加载正文</small>
								</span>
								<input id="translate-dynamic" v-model="draft.translateDynamicContent" type="checkbox" />
								<i aria-hidden="true"></i>
							</label>
						</div>
					</section>

					<DebugPanel
						v-model:enabled="draft.debugLogging"
						:connection="debugConnection"
						:rows="debugRows"
						@clear="clearDebug"
					/>

					<div class="save-dock">
						<div class="save-copy">
							<span class="save-mark" aria-hidden="true"></span>
							<p><strong>设置保存在本机</strong><small>修改后需要手动保存，不会自动调用 API。</small></p>
						</div>
						<div class="actions">
							<button id="test-provider" class="secondary" type="button" :disabled="Boolean(busy)" @click="testProvider">
								{{ busy === "test" ? "测试中…" : "测试当前服务" }}
							</button>
							<button id="save" class="primary" type="submit" :disabled="Boolean(busy)">
								{{ busy === "save" ? "保存中…" : "保存设置" }}
							</button>
						</div>
						<output id="status" :data-error="String(status.error)" role="status" aria-live="polite">
							{{ status.text }}
						</output>
					</div>
				</form>

				<UsagePanel :rows="usageRows" @clear="clearCache" />

				<footer id="privacy" class="privacy">
					<div class="privacy-mark" aria-hidden="true"><Mark /></div>
					<div>
						<p class="section-kicker">GROUND</p>
						<h2>密钥只扎根在本机</h2>
						<p>
							扩展仅在点击图标后取得当前标签页的临时权限。API Key 保存在
							<code>chrome.storage.local</code>，内容脚本无法读取。若未来为他人统一付费，请接入自有后端代理，不要把开发者密钥打包进扩展。
						</p>
					</div>
				</footer>
			</template>
		</main>
	</div>
</template>

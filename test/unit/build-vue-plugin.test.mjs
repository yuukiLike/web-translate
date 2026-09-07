import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { createVueSfcPlugin } from "../../scripts/vue-sfc-plugin.mjs";

async function createBuild(context, component, { relativePath = "options/Example.vue" } = {}) {
	const applicationRoot = await realpath(await mkdtemp(join(tmpdir(), "translator-vue-")));
	context.after(() => rm(applicationRoot, { recursive: true, force: true }));
	const sourceDirectory = join(applicationRoot, "options");
	const entryPoint = join(applicationRoot, relativePath);
	await mkdir(dirname(entryPoint), { recursive: true });
	await writeFile(entryPoint, component);
	return () => build({
		absWorkingDir: applicationRoot,
		bundle: true,
		entryPoints: [entryPoint],
		logLevel: "silent",
		nodePaths: [fileURLToPath(new URL("../../node_modules", import.meta.url))],
		outdir: join(applicationRoot, "output"),
		plugins: [createVueSfcPlugin({ applicationRoot, sourceDirectory })],
		write: false,
	});
}

const scriptAndTemplate = '<script setup>const label = "Hello";</script><template><p>{{ label }}</p></template>';

// 验证提取后的插件仍编译模板与 scoped CSS，并为它们绑定同一个稳定作用域。
test("Vue 模板与样式保留相同作用域标识", async (context) => {
	const compile = await createBuild(context, `${scriptAndTemplate}<style scoped>p { color: red; }</style>`);
	const result = await compile();
	const javascript = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
	const css = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
	const scopeId = css.match(/data-v-[a-f0-9]{8}/u)?.[0];
	assert.ok(scopeId);
	assert.ok(javascript.includes(scopeId));
	assert.match(javascript, /Hello/u);
	assert.match(css, /color: red/u);
});

// 验证组件路径边界仍生效，避免设置页构建意外吸收目录之外的组件。
test("Vue 插件拒绝源目录之外的组件", async (context) => {
	const compile = await createBuild(context, scriptAndTemplate, { relativePath: "outside/Example.vue" });
	await assert.rejects(compile(), /Vue options components must be inside options/u);
});

// 验证不支持的样式形式保持明确失败，不能悄悄生成缺少样式的页面。
test("Vue 插件拒绝外部样式与 CSS 模块", async (context) => {
	for (const [style, expected] of [
		['<style src="./theme.css"></style>', /external <style src> blocks are not supported/u],
		["<style module>p { color: red; }</style>", /CSS module <style> blocks are not supported/u],
	]) {
		const compile = await createBuild(context, scriptAndTemplate + style);
		await assert.rejects(compile(), expected);
	}
});

// 验证模板解析错误保留组件路径，开发者能直接找到出错源文件。
test("Vue 解析错误包含相对组件路径", async (context) => {
	const compile = await createBuild(context, "<template><p></template>");
	await assert.rejects(compile(), /Cannot parse options\/Example.vue/u);
});

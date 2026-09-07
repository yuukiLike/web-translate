import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	assertNoExternalImports,
	assertSafeJavaScript,
	collectBundleOutputs,
	parseBuildArguments,
	writeOrCheckOutputs,
} from "../../scripts/build-outputs.mjs";

async function temporaryDirectory(context) {
	const directory = await mkdtemp(join(tmpdir(), "translator-build-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

function check(outputs) {
	return writeOrCheckOutputs(outputs, { checkOnly: true, buildCommand: "npm run build:fixture" });
}

// 验证三个构建入口使用相同的参数契约，避免重复 --check 被某个入口静默接受。
test("构建参数只允许默认写入或单个检查标记", () => {
	for (const script of ["build-options.mjs", "build-popup.mjs", "build-extension-runtime.mjs"]) {
		assert.deepEqual(parseBuildArguments(script, []), { checkOnly: false });
		assert.deepEqual(parseBuildArguments(script, ["--check"]), { checkOnly: true });
		for (const arguments_ of [["--check", "--check"], ["--unknown"], ["--check", "extra"]]) {
			assert.throws(() => parseBuildArguments(script, arguments_), {
				message: `Usage: node scripts/${script} [--check]`,
			});
		}
	}
});

// 验证产物必须完整且全部在预期集合内，不让缺失样式或意外文件进入写入流程。
test("收集构建产物拒绝缺失项与意外路径", () => {
	const expected = ["/generated/page.js", "/generated/page.css"];
	const javascript = { path: expected[0], contents: new Uint8Array([65, 0, 66]) };
	assert.throws(() => collectBundleOutputs([javascript], expected, "fixture"), /did not produce page.css/u);
	assert.throws(
		() => collectBundleOutputs([{ path: "/unexpected.js", contents: [] }], expected, "fixture"),
		/Unexpected fixture output: \/unexpected.js/u,
	);
	const css = { path: expected[1], contents: Buffer.from("p { color: red; }") };
	const outputs = collectBundleOutputs([javascript, css], expected, "fixture");
	assert.deepEqual(outputs.get(expected[0]), Buffer.from([65, 0, 66]));
});

// 验证源文件和输出文件的外部依赖都会被拒绝，错误能定位文件与依赖。
test("外部依赖检查同时覆盖输入与输出", () => {
	for (const section of ["inputs", "outputs"]) {
		const metafile = { inputs: {}, outputs: {} };
		metafile[section]["src/page.js"] = { imports: [{ external: true, path: "remote-module" }] };
		assert.throws(() => assertNoExternalImports(metafile, "Fixture"), {
			message: "Fixture bundle contains an external import in src/page.js: remote-module",
		});
	}
});

// 验证扩展页面的动态执行检查保留 eval 和 Function 两种禁用形式。
test("页面产物拒绝动态代码执行", () => {
	assert.doesNotThrow(() => assertSafeJavaScript("const value = JSON.parse(input);", "page.js"));
	assert.throws(() => assertSafeJavaScript("eval (input)", "page.js"), /page.js.*eval\(\)/u);
	assert.throws(() => assertSafeJavaScript("new Function (input)", "page.js"), /page.js.*new Function\(\)/u);
});

// 验证写入会创建目录并保留全部字节，而检查不会重写已经匹配的产物。
test("写入与检查保留相同的二进制产物", async (context) => {
	const directory = await temporaryDirectory(context);
	const outputPath = join(directory, "中文 空格", "page.js");
	const contents = Buffer.from([65, 0, 66, 255]);
	const outputs = new Map([[outputPath, contents]]);
	await writeOrCheckOutputs(outputs, { checkOnly: false, buildCommand: "unused" });
	assert.deepEqual(await readFile(outputPath), contents);
	const before = await stat(outputPath);
	await check(outputs);
	assert.equal((await stat(outputPath)).mtimeMs, before.mtimeMs);
});

// 验证缺失产物的检查只报告问题，不创建任何输出目录。
test("检查缺失产物保持文件系统只读", async (context) => {
	const directory = await temporaryDirectory(context);
	const missingDirectory = join(directory, "missing");
	await assert.rejects(check(new Map([[join(missingDirectory, "page.js"), Buffer.from("new")]])), {
		message: "Generated page.js is missing. Run npm run build:fixture.",
	});
	await assert.rejects(stat(missingDirectory), { code: "ENOENT" });
});

// 验证过期产物保持原样，并向开发者提示正确的重新构建命令。
test("检查过期产物不会覆盖现有内容", async (context) => {
	const directory = await temporaryDirectory(context);
	const outputPath = join(directory, "page.js");
	await writeFile(outputPath, "old");
	await assert.rejects(check(new Map([[outputPath, Buffer.from("new")]])), {
		message: "Generated page.js is stale. Run npm run build:fixture.",
	});
	assert.equal(await readFile(outputPath, "utf8"), "old");
});

// 验证真实读取失败保留原始异常，不被误诊为文件不存在。
test("目录读取失败保留错误原因", async (context) => {
	const directory = await temporaryDirectory(context);
	await assert.rejects(check(new Map([[directory, Buffer.from("new")]])), (error) => {
		assert.match(error.message, /Could not read generated/u);
		assert.doesNotMatch(error.message, /is missing/u);
		assert.equal(error.cause.code, "EISDIR");
		return true;
	});
});

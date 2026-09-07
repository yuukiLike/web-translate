import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

/** 所有构建入口只接受默认写入或单个 --check，检查模式不改动文件。 */
export function parseBuildArguments(scriptName, arguments_ = process.argv.slice(2)) {
	if (arguments_.length === 0) {
		return { checkOnly: false };
	}
	if (arguments_.length === 1 && arguments_[0] === "--check") {
		return { checkOnly: true };
	}
	throw new Error(`Usage: node scripts/${scriptName} [--check]`);
}

/** 先确认产物完整且没有意外输出，再交给写入或比对流程。 */
export function collectBundleOutputs(outputFiles, expectedPaths, bundleName) {
	const expected = new Set(expectedPaths);
	const outputs = new Map();
	for (const output of outputFiles) {
		if (!expected.has(output.path)) {
			throw new Error(`Unexpected ${bundleName} output: ${output.path}`);
		}
		outputs.set(output.path, Buffer.from(output.contents));
	}
	for (const outputPath of expected) {
		if (!outputs.has(outputPath)) {
			throw new Error(`esbuild did not produce ${basename(outputPath)}`);
		}
	}
	return outputs;
}

export function assertNoExternalImports(metafile, bundleName) {
	const entries = [...Object.entries(metafile.inputs), ...Object.entries(metafile.outputs)];
	for (const [filePath, entry] of entries) {
		const external = entry.imports.find((item) => item.external);
		if (external) {
			throw new Error(
				`${bundleName} bundle contains an external import in ${filePath}: ${external.path}`,
			);
		}
	}
}

export function assertSafeJavaScript(contents, outputName) {
	const forbiddenPatterns = [
		{ label: "eval()", pattern: /\beval\s*\(/u },
		{ label: "new Function()", pattern: /\bnew\s+Function\s*\(/u },
	];
	for (const { label, pattern } of forbiddenPatterns) {
		if (pattern.test(contents)) {
			throw new Error(`Generated ${outputName} contains forbidden dynamic code: ${label}`);
		}
	}
}

export async function writeOrCheckOutputs(outputs, { checkOnly, buildCommand }) {
	for (const [outputPath, contents] of outputs) {
		if (checkOnly) {
			await checkOutput(outputPath, contents, buildCommand);
			continue;
		}
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, contents);
	}
}

async function checkOutput(outputPath, contents, buildCommand) {
	const outputName = basename(outputPath);
	let existing;
	try {
		existing = await readFile(outputPath);
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new Error(`Generated ${outputName} is missing. Run ${buildCommand}.`, { cause: error });
		}
		throw new Error(`Could not read generated ${outputName}: ${error.message}`, { cause: error });
	}
	if (!existing.equals(contents)) {
		throw new Error(`Generated ${outputName} is stale. Run ${buildCommand}.`);
	}
}

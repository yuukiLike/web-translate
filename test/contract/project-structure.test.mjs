import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import test from "node:test";

const applicationRoot = resolve(new URL("../..", import.meta.url).pathname);

async function listFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(path)));
		} else {
			files.push(path);
		}
	}
	return files;
}

// 验证人工维护的源码遵守 AGENTS.md 的可读性约束，生成产物不参与行数限制。
test("人工维护的源码文件不超过 300 行", async () => {
	const roots = ["chrome-extension/background", "scripts", "src", "test"];
	const allowedExtensions = new Set([".css", ".js", ".mjs", ".vue"]);
	const oversized = [];
	for (const root of roots) {
		for (const file of await listFiles(resolve(applicationRoot, root))) {
			if (!allowedExtensions.has(extname(file))) {
				continue;
			}
			const lines = (await readFile(file, "utf8")).trimEnd().split("\n").length;
			if (lines > 300) {
				oversized.push(`${relative(applicationRoot, file)} (${lines} 行)`);
			}
		}
	}
	assert.deepEqual(oversized, []);
});

// 验证每个测试用例前都有中文注释，确保读者先看到测试意图再阅读断言细节。
test("每个 test 都有紧邻的中文意图注释", async () => {
	const testFiles = (await listFiles(resolve(applicationRoot, "test"))).filter((file) =>
		file.endsWith(".test.mjs"),
	);
	const missingComments = [];
	for (const file of testFiles) {
		const lines = (await readFile(file, "utf8")).split("\n");
		for (const [index, line] of lines.entries()) {
			if (!/^test\(/u.test(line.trim())) {
				continue;
			}
			const comment = lines[index - 1]?.trim() ?? "";
			if (!/^\/\/.*[\u3400-\u9fff]/u.test(comment)) {
				missingComments.push(`${relative(applicationRoot, file)}:${index + 1}`);
			}
		}
	}
	assert.deepEqual(missingComments, []);
});

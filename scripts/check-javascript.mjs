import { glob } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["chrome-extension/background", "scripts", "src"];

async function findJavaScriptFiles(directory) {
	const files = [];
	for await (const entry of glob("**/*.{js,mjs}", { cwd: directory, withFileTypes: true })) {
		if (entry.isFile()) {
			files.push(resolve(entry.parentPath, entry.name));
		}
	}
	return files;
}

const files = (
	await Promise.all(sourceRoots.map((directory) => findJavaScriptFiles(resolve(applicationRoot, directory))))
).flat();

for (const file of files.sort()) {
	const result = spawnSync(process.execPath, ["--check", file], {
		cwd: applicationRoot,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		process.stderr.write(result.stderr || result.stdout);
		throw new Error(`JavaScript syntax check failed: ${relative(applicationRoot, file)}`);
	}
}

console.log(`Checked ${files.length} JavaScript source files.`);

import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["chrome-extension/background", "scripts", "src"];

async function findJavaScriptFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await findJavaScriptFiles(path)));
		} else if (/\.(?:js|mjs)$/u.test(entry.name)) {
			files.push(path);
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

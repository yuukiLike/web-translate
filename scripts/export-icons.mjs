import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliArguments = process.argv.slice(2);
if (cliArguments.length !== 0 && (cliArguments.length !== 2 || cliArguments[0] !== "--output-dir")) {
	throw new Error("Usage: node scripts/export-icons.mjs [--output-dir <directory>]");
}
if (process.platform !== "darwin") {
	throw new Error("Icon export requires macOS and its built-in /usr/bin/sips SVG renderer.");
}

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(applicationRoot, "chrome-extension/assets/icons");
const outputDirectory = cliArguments.length ? resolve(cliArguments[1]) : sourceDirectory;
const stagingDirectory = await mkdtemp(join(tmpdir(), "web-translate-icons-"));
const sizes = [16, 32, 48, 128];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function exportIcon(size) {
	const source = join(sourceDirectory, size === 16 ? "icon-small.svg" : "icon.svg");
	const output = join(stagingDirectory, `icon-${size}.png`);
	execFileSync("/usr/bin/sips", [
		"-s", "format", "png", "-z", String(size), String(size), source, "--out", output,
	], { stdio: "pipe" });

	const png = await readFile(output);
	if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature)) {
		throw new Error(`SVG renderer did not produce a PNG for icon-${size}.png.`);
	}
	if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
		throw new Error(`SVG renderer produced incorrect dimensions for icon-${size}.png.`);
	}
}

try {
	// Validate every rendered size before replacing any checked-in asset.
	for (const size of sizes) {
		await exportIcon(size);
	}
	await mkdir(outputDirectory, { recursive: true });
	for (const size of sizes) {
		const filename = `icon-${size}.png`;
		await copyFile(join(stagingDirectory, filename), join(outputDirectory, filename));
	}
	console.log(`Exported 16, 32, 48 and 128 px icons to ${outputDirectory}.`);
} finally {
	await rm(stagingDirectory, { recursive: true, force: true });
}

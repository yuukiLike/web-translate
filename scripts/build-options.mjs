import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { compileScript, compileStyle, parse } from "@vue/compiler-sfc";
import { build } from "esbuild";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const optionsSourceDirectory = resolve(applicationRoot, "src/options");
const expectedOutputPaths = new Map([
	[resolve(applicationRoot, "options.js"), "options.js"],
	[resolve(applicationRoot, "options.css"), "options.css"],
]);
const commandArguments = process.argv.slice(2);

if (
	commandArguments.length > 1 ||
	(commandArguments.length === 1 && commandArguments[0] !== "--check")
) {
	throw new Error("Usage: node scripts/build-options.mjs [--check]");
}

const checkOnly = commandArguments[0] === "--check";

function describeCompilerError(error) {
	if (typeof error === "string") {
		return error;
	}
	if (error && typeof error.message === "string") {
		return error.message;
	}
	return String(error);
}

function createScopeId(filePath) {
	const sourcePath = relative(optionsSourceDirectory, filePath).replaceAll("\\", "/");
	const digest = createHash("sha256").update(sourcePath).digest("hex").slice(0, 8);
	return `data-v-${digest}`;
}

function getScriptLoader(descriptor, filePath) {
	const scriptLanguage = descriptor.scriptSetup?.lang ?? descriptor.script?.lang ?? "js";
	if (["js", "jsx", "ts", "tsx"].includes(scriptLanguage)) {
		return scriptLanguage;
	}
	throw new Error(
		`Cannot compile ${relative(applicationRoot, filePath)}: unsupported script language "${scriptLanguage}".`,
	);
}

function assertOptionsVueFile(filePath) {
	const sourcePath = relative(optionsSourceDirectory, filePath);
	const outsideOptionsDirectory = sourcePath === ".." || sourcePath.startsWith(`..${sep}`);
	if (sourcePath === "" || outsideOptionsDirectory || isAbsolute(sourcePath)) {
		throw new Error(
			`Vue options components must be inside ${relative(applicationRoot, optionsSourceDirectory)}: ${filePath}`,
		);
	}
}

function createVueSfcPlugin() {
	const compiledStyles = new Map();

	return {
		name: "vue-options-sfc",
		setup(esbuild) {
			esbuild.onResolve({ filter: /^vue-options-style:/ }, (arguments_) => ({
				path: arguments_.path,
				namespace: "vue-options-style",
			}));

			esbuild.onLoad(
				{ filter: /.*/, namespace: "vue-options-style" },
				(arguments_) => {
					const contents = compiledStyles.get(arguments_.path);
					if (contents === undefined) {
						return {
							errors: [{ text: `Missing compiled Vue style: ${arguments_.path}` }],
						};
					}
					return { contents, loader: "css" };
				},
			);

			esbuild.onLoad({ filter: /\.vue$/ }, async (arguments_) => {
				try {
					assertOptionsVueFile(arguments_.path);
					const source = await readFile(arguments_.path, "utf8");
					const sourceName = relative(applicationRoot, arguments_.path).replaceAll("\\", "/");
					const parsed = parse(source, {
						filename: sourceName,
						sourceMap: false,
					});

					if (parsed.errors.length > 0) {
						return {
							errors: parsed.errors.map((error) => ({
								text: `Cannot parse ${sourceName}: ${describeCompilerError(error)}`,
							})),
						};
					}

					const scopeId = createScopeId(arguments_.path);
					const compiledScript = compileScript(parsed.descriptor, {
						id: scopeId,
						inlineTemplate: true,
						isProd: true,
						sourceMap: false,
					});
					const styleImports = [];

					for (const [styleIndex, style] of parsed.descriptor.styles.entries()) {
						if (style.src) {
							throw new Error(
								`Cannot compile ${sourceName}: external <style src> blocks are not supported.`,
							);
						}
						if (style.module) {
							throw new Error(
								`Cannot compile ${sourceName}: CSS module <style> blocks are not supported.`,
							);
						}

						const compiledStyle = compileStyle({
							filename: sourceName,
							id: scopeId,
							isProd: true,
							scoped: style.scoped,
							source: style.content,
							preprocessLang: style.lang,
						});
						if (compiledStyle.errors.length > 0) {
							throw new Error(
								`Cannot compile style ${styleIndex + 1} in ${sourceName}: ${compiledStyle.errors
									.map(describeCompilerError)
									.join("; ")}`,
							);
						}

						const virtualStylePath = `vue-options-style:${scopeId}-${styleIndex}.css`;
						compiledStyles.set(virtualStylePath, compiledStyle.code);
						styleImports.push(`import ${JSON.stringify(virtualStylePath)};`);
					}

					return {
						contents: `${styleImports.join("\n")}\n${compiledScript.content}`,
						loader: getScriptLoader(parsed.descriptor, arguments_.path),
						resolveDir: dirname(arguments_.path),
						watchFiles: [arguments_.path],
					};
				} catch (error) {
					return {
						errors: [
							{
								text: `Failed to compile ${relative(applicationRoot, arguments_.path)}: ${describeCompilerError(error)}`,
							},
						],
					};
				}
			});
		},
	};
}

function assertNoExternalImports(metafile) {
	for (const [inputPath, input] of Object.entries(metafile.inputs)) {
		const externalImport = input.imports.find((import_) => import_.external);
		if (externalImport) {
			throw new Error(
				`Options bundle contains an external import in ${inputPath}: ${externalImport.path}`,
			);
		}
	}

	for (const [outputPath, output] of Object.entries(metafile.outputs)) {
		const externalImport = output.imports.find((import_) => import_.external);
		if (externalImport) {
			throw new Error(
				`Options bundle contains an external import in ${outputPath}: ${externalImport.path}`,
			);
		}
	}
}

function assertSafeJavaScript(contents) {
	const forbiddenPatterns = [
		{ label: "eval()", pattern: /\beval\s*\(/u },
		{ label: "new Function()", pattern: /\bnew\s+Function\s*\(/u },
	];
	for (const { label, pattern } of forbiddenPatterns) {
		if (pattern.test(contents)) {
			throw new Error(`Generated options.js contains forbidden dynamic code: ${label}`);
		}
	}
}

async function createOptionsOutputs() {
	const bundle = await build({
		absWorkingDir: applicationRoot,
		banner: {
			css: "/* Generated by scripts/build-options.mjs. Do not edit. */",
			js: "// Generated by scripts/build-options.mjs. Do not edit.",
		},
		bundle: true,
		charset: "utf8",
		define: {
			"process.env.NODE_ENV": '"production"',
			__VUE_OPTIONS_API__: "false",
			__VUE_PROD_DEVTOOLS__: "false",
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
		},
		entryPoints: [{ in: "src/options/main.js", out: "options" }],
		format: "iife",
		legalComments: "eof",
		logLevel: "warning",
		metafile: true,
		minify: true,
		outdir: applicationRoot,
		packages: "bundle",
		platform: "browser",
		plugins: [createVueSfcPlugin()],
		sourcemap: false,
		splitting: false,
		target: "chrome140",
		treeShaking: true,
		write: false,
	});

	assertNoExternalImports(bundle.metafile);
	const generatedOutputs = new Map();
	for (const outputFile of bundle.outputFiles) {
		if (![".css", ".js"].includes(extname(outputFile.path))) {
			throw new Error(`esbuild produced an unexpected options output: ${outputFile.path}`);
		}
		if (!expectedOutputPaths.has(outputFile.path)) {
			throw new Error(`esbuild produced an unexpected options output: ${outputFile.path}`);
		}
		generatedOutputs.set(outputFile.path, Buffer.from(outputFile.contents));
	}

	for (const [outputPath, outputName] of expectedOutputPaths) {
		if (!generatedOutputs.has(outputPath)) {
			throw new Error(`esbuild did not produce ${outputName}`);
		}
	}

	assertSafeJavaScript(generatedOutputs.get(resolve(applicationRoot, "options.js")).toString("utf8"));
	return generatedOutputs;
}

const generatedOutputs = await createOptionsOutputs();
if (checkOnly) {
	for (const [outputPath, outputName] of expectedOutputPaths) {
		let existingOutput;
		try {
			existingOutput = await readFile(outputPath);
		} catch (error) {
			if (error && error.code === "ENOENT") {
				throw new Error(`Generated ${outputName} is missing. Run npm run build:options.`);
			}
			throw new Error(`Could not read generated ${outputName}: ${describeCompilerError(error)}`);
		}
		if (!existingOutput.equals(generatedOutputs.get(outputPath))) {
			throw new Error(`Generated ${outputName} is stale. Run npm run build:options.`);
		}
	}
	console.log("Generated options.js and options.css are up to date.");
} else {
	await Promise.all(
		[...generatedOutputs].map(([outputPath, contents]) => writeFile(outputPath, contents)),
	);
	console.log("Generated options.js and options.css.");
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";

import { compileScript, compileStyle, parse } from "@vue/compiler-sfc";

/** 把 options 目录内的 Vue 单文件组件和 scoped 样式交给 esbuild。 */
export function createVueSfcPlugin({ applicationRoot, sourceDirectory }) {
	const compiledStyles = new Map();

	return {
		name: "vue-options-sfc",
		setup(esbuild) {
			esbuild.onResolve({ filter: /^vue-options-style:/ }, ({ path }) => ({
				path,
				namespace: "vue-options-style",
			}));
			esbuild.onLoad({ filter: /.*/, namespace: "vue-options-style" }, ({ path }) => {
				const contents = compiledStyles.get(path);
				if (contents === undefined) {
					return { errors: [{ text: `Missing compiled Vue style: ${path}` }] };
				}
				return { contents, loader: "css" };
			});
			esbuild.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
				const sourceName = relative(applicationRoot, path).replaceAll("\\", "/");
				try {
					assertComponentLocation(path, sourceDirectory, applicationRoot);
					const source = await readFile(path, "utf8");
					const parsed = parse(source, { filename: sourceName, sourceMap: false });
					if (parsed.errors.length > 0) {
						return {
							errors: parsed.errors.map((error) => ({
								text: `Cannot parse ${sourceName}: ${describeCompilerError(error)}`,
							})),
						};
					}
					const scopeId = createScopeId(path, sourceDirectory);
					const hasScopedStyle = parsed.descriptor.styles.some((style) => style.scoped);
					const compiledScript = compileScript(parsed.descriptor, {
						id: scopeId,
						genDefaultAs: hasScopedStyle ? "__bt_component" : undefined,
						inlineTemplate: true,
						isProd: true,
						sourceMap: false,
					});
					const styleImports = compileComponentStyles(
						parsed.descriptor.styles, scopeId, sourceName, compiledStyles,
					);
					const componentExport = hasScopedStyle
						? `\n__bt_component.__scopeId = ${JSON.stringify(scopeId)};\nexport default __bt_component;`
						: "";
					return {
						contents: `${styleImports.join("\n")}\n${compiledScript.content}${componentExport}`,
						loader: getScriptLoader(parsed.descriptor, sourceName),
						resolveDir: dirname(path),
						watchFiles: [path],
					};
				} catch (error) {
					return { errors: [{ text: `Failed to compile ${sourceName}: ${describeCompilerError(error)}` }] };
				}
			});
		},
	};
}

function compileComponentStyles(styles, scopeId, sourceName, compiledStyles) {
	const imports = [];
	for (const [index, style] of styles.entries()) {
		if (style.src) {
			throw new Error(`Cannot compile ${sourceName}: external <style src> blocks are not supported.`);
		}
		if (style.module) {
			throw new Error(`Cannot compile ${sourceName}: CSS module <style> blocks are not supported.`);
		}
		const compiled = compileStyle({
			filename: sourceName,
			id: scopeId,
			isProd: true,
			scoped: style.scoped,
			source: style.content,
			preprocessLang: style.lang,
		});
		if (compiled.errors.length > 0) {
			throw new Error(
				`Cannot compile style ${index + 1} in ${sourceName}: ${compiled.errors.map(describeCompilerError).join("; ")}`,
			);
		}
		const virtualPath = `vue-options-style:${scopeId}-${index}.css`;
		compiledStyles.set(virtualPath, compiled.code);
		imports.push(`import ${JSON.stringify(virtualPath)};`);
	}
	return imports;
}

function describeCompilerError(error) {
	if (typeof error === "string") {
		return error;
	}
	return typeof error?.message === "string" ? error.message : String(error);
}

function createScopeId(filePath, sourceDirectory) {
	const sourcePath = relative(sourceDirectory, filePath).replaceAll("\\", "/");
	const digest = createHash("sha256").update(sourcePath).digest("hex").slice(0, 8);
	return `data-v-${digest}`;
}

function getScriptLoader(descriptor, sourceName) {
	const language = descriptor.scriptSetup?.lang ?? descriptor.script?.lang ?? "js";
	if (["js", "jsx", "ts", "tsx"].includes(language)) {
		return language;
	}
	throw new Error(`Cannot compile ${sourceName}: unsupported script language "${language}".`);
}

function assertComponentLocation(filePath, sourceDirectory, applicationRoot) {
	const sourcePath = relative(sourceDirectory, filePath);
	if (sourcePath === "" || sourcePath === ".." || sourcePath.startsWith(`..${sep}`) || isAbsolute(sourcePath)) {
		throw new Error(
			`Vue options components must be inside ${relative(applicationRoot, sourceDirectory)}: ${filePath}`,
		);
	}
}

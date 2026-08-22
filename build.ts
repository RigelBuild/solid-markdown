import { rm } from "node:fs/promises";
import { type PluginItem, transformAsync } from "@babel/core";
// @ts-expect-error - @babel/preset-typescript ships no type declarations.
import tsPreset from "@babel/preset-typescript";
// @ts-expect-error - babel-preset-solid ships no type declarations.
import solid from "babel-preset-solid";
import type { BunPlugin } from "bun";

/**
 * Build the publishable `dist/`.
 *
 * `babel-preset-solid@2` is the Solid compiler, and it is used in both output
 * modes; the two modes differ only in whether the JSX is compiled now or left
 * for the consumer's own compiler:
 *
 *   - **Compiled** (`index.js`, `dev.js`, `server.js`) — Solid compiles the JSX
 *     to `@solidjs/web` runtime calls, then `Bun.build` bundles the now
 *     JSX-free modules into one file per variant. `Bun.build` never sees JSX.
 *   - **Source** (`index.jsx` + sibling `jsx-runtime.js`) — babel strips types
 *     but leaves the JSX untransformed, and the files are written directly, so
 *     the `solid` export condition ships raw JSX for the consuming app's Solid
 *     compiler (matching its exact `solid-js` version and generate settings).
 *     This variant is NOT routed through `Bun.build`, which would apply its own
 *     automatic JSX-runtime transform (emitting a `@solidjs/web/jsx-dev-runtime`
 *     import that subpath does not provide) and defeat JSX preservation.
 *
 * The compiled variants set `moduleName: "@solidjs/web"` (babel-preset-solid@2's
 * default) and `hydratable: true` so the DOM and SSR outputs interoperate for
 * hydration.
 */

const entry = "src/index.tsx";
const outdir = "dist";

// Runtime + peer deps stay external so the published package resolves them from
// the consumer's tree rather than inlining them (they are declared under
// `dependencies`/`peerDependencies`).
const external = [
	"solid-js",
	"@solidjs/web",
	"unified",
	"remark-parse",
	"remark-rehype",
	"unist-util-visit",
	"vfile",
	"hast-util-to-jsx-runtime",
	"html-url-attributes",
	"devlop",
];

type CompiledVariant = { file: string; generate: "dom" | "ssr"; dev: boolean };

const compiledVariants: ReadonlyArray<CompiledVariant> = [
	{ file: "index.js", generate: "dom", dev: false },
	{ file: "dev.js", generate: "dom", dev: true },
	{ file: "server.js", generate: "ssr", dev: false },
];

/** Compile JSX away with `babel-preset-solid`, so `Bun.build` bundles no JSX. */
function solidCompilePlugin(variant: CompiledVariant): BunPlugin {
	return {
		name: `solid-${variant.file}`,
		setup(build) {
			build.onLoad({ filter: /\.tsx$/ }, async (args) => {
				const source = await Bun.file(args.path).text();
				const result = await transformAsync(source, {
					filename: args.path,
					presets: [
						[tsPreset, { onlyRemoveTypeImports: true }],
						[
							solid,
							{
								generate: variant.generate,
								hydratable: true,
								dev: variant.dev,
							},
						],
					],
					sourceMaps: false,
				});
				if (!result?.code) {
					throw new Error(`solid build: empty transform for ${args.path}`);
				}
				return { contents: result.code, loader: "js" };
			});
		},
	};
}

/** Strip types but preserve JSX for the `solid` export condition. */
async function emitSource(src: string): Promise<string> {
	const source = await Bun.file(src).text();
	const presets: PluginItem[] = [[tsPreset, { onlyRemoveTypeImports: true }]];
	const result = await transformAsync(source, {
		filename: src,
		presets,
		plugins: ["@babel/plugin-syntax-jsx"],
		sourceMaps: false,
	});
	if (!result?.code) {
		throw new Error(`solid build: empty source transform for ${src}`);
	}
	return result.code;
}

await rm(outdir, { recursive: true, force: true });

for (const variant of compiledVariants) {
	const result = await Bun.build({
		entrypoints: [entry],
		external,
		target: variant.generate === "ssr" ? "node" : "browser",
		format: "esm",
		plugins: [solidCompilePlugin(variant)],
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error(`solid build: ${variant.file} failed`);
	}
	const [artifact] = result.outputs;
	if (!artifact)
		throw new Error(`solid build: ${variant.file} produced no output`);
	await Bun.write(`${outdir}/${variant.file}`, await artifact.text());
}

// Source variant: JSX left intact for the consumer's Solid compiler. `index.tsx`
// imports the JSX-free `./jsx-runtime`; ship it as a resolvable sibling and point
// the import at the emitted `.js`.
const indexSource = (await emitSource(entry)).replaceAll(
	'from "./jsx-runtime"',
	'from "./jsx-runtime.js"',
);
await Bun.write(`${outdir}/index.jsx`, indexSource);
await Bun.write(
	`${outdir}/jsx-runtime.js`,
	await emitSource("src/jsx-runtime.ts"),
);

// Type declarations: tsc emits the single `index.d.ts` the exports map points at.
const dts = Bun.spawnSync(["tsc", "--project", "tsconfig.build.json"], {
	stdout: "inherit",
	stderr: "inherit",
});
if (dts.exitCode !== 0)
	throw new Error("solid build: tsc declaration emit failed");

console.log(
	`built ${compiledVariants.length} compiled variants + index.jsx source + index.d.ts into ${outdir}/`,
);

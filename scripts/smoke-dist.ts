/**
 * Post-build guard on the published `dist/`. `tsc`/`biome`/`bun test` never
 * import `dist` (tests run against `src` through the babel harness), so without
 * this check a dead-on-arrival artifact passes every other gate. Run after
 * `build`, in CI and before publish.
 *
 * Two artifact shapes, two checks:
 *   - Compiled `.js` entries — import each and assert the public API resolves.
 *     A wrong-target build emits a bare runtime import for a subpath the peer
 *     removed (`solid-js/web`), throwing `ERR_PACKAGE_PATH_NOT_EXPORTED` on load.
 *   - The `.jsx` source entry backing the `solid` export condition — it ships
 *     untransformed JSX, so it cannot be imported directly. Instead compile it
 *     with `babel-preset-solid` exactly as a consuming app would and assert the
 *     result imports `@solidjs/web` and never a `jsx-dev-runtime`/`solid-js/web`
 *     subpath (the failure mode when a bundler's own JSX transform leaks in).
 */

import { transformAsync } from "@babel/core";
// @ts-expect-error - babel-preset-solid ships no type declarations.
import solid from "babel-preset-solid";

const jsEntries = ["index.js", "dev.js", "server.js"] as const;
const expected = [
	"MarkdownAsync",
	"MarkdownResource",
	"default",
	"defaultUrlTransform",
] as const;
const badSubpaths = ["solid-js/web", "@solidjs/web/jsx-dev-runtime", "jsxDEV"];

let failed = false;

function fail(entry: string, detail: string): void {
	console.error(`✗ dist/${entry}: ${detail}`);
	failed = true;
}

function errorDetail(error: unknown): string {
	if (error && typeof error === "object" && "code" in error) {
		return String(error.code);
	}
	return error instanceof Error ? error.message : String(error);
}

for (const entry of jsEntries) {
	try {
		const mod = await import(`../dist/${entry}`);
		const missing = expected.filter((name) => !(name in mod));
		if (missing.length > 0) {
			fail(entry, `missing exports ${missing.join(", ")}`);
		} else {
			console.log(`✓ dist/${entry}`);
		}
	} catch (error) {
		fail(entry, errorDetail(error));
	}
}

// The `.jsx` source entry: it must ship real JSX (not a leaked runtime import),
// and must compile through a consumer's Solid compiler to `@solidjs/web` calls.
const jsxSource = await Bun.file("dist/index.jsx").text();
const leaked = badSubpaths.find((s) => jsxSource.includes(s));
if (leaked) {
	fail("index.jsx", `ships a leaked runtime reference: ${leaked}`);
} else if (!jsxSource.includes("<>")) {
	fail("index.jsx", "no JSX found — the source variant was transformed away");
} else {
	try {
		const compiled = await transformAsync(jsxSource, {
			filename: "dist/index.jsx",
			presets: [[solid, { generate: "dom", hydratable: true }]],
			sourceMaps: false,
		});
		const code = compiled?.code ?? "";
		const stillBad = badSubpaths.find((s) => code.includes(s));
		if (stillBad) {
			fail("index.jsx", `compiles to a bad runtime reference: ${stillBad}`);
		} else if (!code.includes("@solidjs/web")) {
			fail("index.jsx", "compiled output does not import @solidjs/web");
		} else {
			console.log("✓ dist/index.jsx (compiles to @solidjs/web)");
		}
	} catch (error) {
		fail("index.jsx", `does not compile: ${errorDetail(error)}`);
	}
}

if (failed) {
	console.error("dist smoke check failed — the published bundle is broken.");
	process.exit(1);
}

console.log(
	`dist smoke check passed (${jsEntries.length} compiled + 1 source entry).`,
);

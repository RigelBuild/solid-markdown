import { transformAsync } from "@babel/core";
// @ts-expect-error - @babel/preset-typescript ships no type declarations.
import tsPreset from "@babel/preset-typescript";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// @ts-expect-error - babel-preset-solid ships no type declarations.
import solid from "babel-preset-solid";
import { plugin } from "bun";

/**
 * Bun test harness for Solid 2 JSX. Bun's native transpiler does not run the
 * Solid JSX transform, so component tests need `babel-preset-solid` applied to
 * every `.tsx`/`.ts` source the suite loads. `SOLID_GENERATE` selects the
 * output mode (mirrors vitest's `--mode ssr`):
 *   - `dom` (client leg): reactive DOM runtime, happy-dom globals registered.
 *   - `ssr` (server leg): SSR string runtime, node env, no DOM globals.
 */
const generate = process.env.SOLID_GENERATE === "ssr" ? "ssr" : "dom";

// The client leg needs DOM globals for `@solidjs/testing-library`'s `render`.
// The SSR leg renders to a string in a node env and must NOT have them.
if (generate === "dom") {
	GlobalRegistrator.register();
}

plugin({
	name: "solid-babel",
	setup(build) {
		// Only `.tsx` files carry Solid JSX (our `src` + `test` sources); no
		// dependency ships `.tsx`, so this never intercepts babel's own
		// `node_modules`/cache internals (which bun would then mis-mark as async
		// modules and fail babel's synchronous config `require`).
		build.onLoad({ filter: /\.tsx$/ }, async (args) => {
			const source = await Bun.file(args.path).text();
			const result = await transformAsync(source, {
				filename: args.path,
				presets: [
					[tsPreset, { onlyRemoveTypeImports: true }],
					[solid, { generate }],
				],
				sourceMaps: "inline",
			});

			if (!result?.code) {
				throw new Error(`solid-babel: empty transform for ${args.path}`);
			}

			return { contents: result.code, loader: "js" };
		});
	},
});

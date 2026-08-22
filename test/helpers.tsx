import { type JSX, NoHydration, renderToString } from "@solidjs/web";
import type { Root, RootContent } from "hast";
import type { Plugin } from "unified";

type DeferredPlugin = {
	plugin: Plugin<[], Root>;
	reject: (error: Error) => void;
	resolve: () => void;
};

const decoder = new TextDecoder();

export function normalizeHtml(value: string): string {
	return (
		value
			.replace(/\sdata-hk="[^"]*"/g, "")
			// Solid 2 SSR emits `_hk=N` hydration keys and `<!--!$-->` boundary
			// markers between dynamic siblings; both are hydration plumbing with no
			// semantic content, so drop them for static HTML comparison.
			.replace(/\s_hk=\d+/g, "")
			.replace(/<!--!?\$?-->/g, "")
			.replace(/ class="([^"]*?)\s+"/g, ' class="$1"')
			.replace(/\s+>/g, ">")
			.trim()
	);
}

export function renderSync(code: () => JSX.Element): string {
	// These tests compare static HTML strings and never hydrate, so render
	// under `NoHydration` to drop most of Solid 2's hydration output; the
	// residual `_hk`/marker artifacts are stripped in `normalizeHtml`.
	return normalizeHtml(
		renderToString(() => <NoHydration>{code()}</NoHydration>),
	);
}

export async function readStream(stream: {
	pipeTo: (writable: WritableStream) => Promise<void> | void;
}): Promise<string> {
	let result = "";

	await Promise.resolve(
		stream.pipeTo(
			new WritableStream({
				write(chunk) {
					result +=
						typeof chunk === "string"
							? chunk
							: decoder.decode(chunk, { stream: true });
				},
			}),
		),
	);

	return normalizeHtml(result + decoder.decode());
}

export function prependNodes(...nodes: RootContent[]): Plugin<[], Root> {
	return function plugin() {
		return (tree) => {
			tree.children.unshift(...nodes);
		};
	};
}

export function deferPlugin(): DeferredPlugin {
	let resolvePromise!: () => void;
	let rejectPromise!: (error: Error) => void;
	const promise = new Promise<void>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	void promise.catch(() => undefined);

	return {
		plugin() {
			return async (tree) => {
				await promise;
				return tree;
			};
		},
		reject(error) {
			rejectPromise(error);
		},
		resolve() {
			resolvePromise();
		},
	};
}

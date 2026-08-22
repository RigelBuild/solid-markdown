import { Dynamic, type JSX } from "@solidjs/web";
import { type Component, createComponent, merge } from "solid-js";

/**
 * Fork-local JSX runtime for `hast-util-to-jsx-runtime`, over Solid-2
 * primitives. Replaces the Solid-1-bound third-party `solid-jsx` dependency
 * (see the adopted design record, A2). Only the production runtime surface
 * `hast-util-to-jsx-runtime` exercises is implemented — no `jsxDEV`, and none
 * of solid-jsx's MDX-only machinery (`MDXProvider`, `useMDXComponents`, the
 * `mjx-` compat cache).
 */

type Props = Record<string, unknown>;

export function Fragment(props: { children?: JSX.Element }): JSX.Element {
	return props.children;
}

export function jsx(
	type: string | Component<Props>,
	props: Props,
): JSX.Element {
	if (typeof type === "string") {
		return createComponent(Dynamic, merge(props, { component: type }));
	}

	return createComponent(type, props);
}

export const jsxs = jsx;

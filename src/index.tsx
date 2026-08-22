import type { JSX } from "@solidjs/web";
import { unreachable } from "devlop";
import type { Element, Nodes, Parents } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { urlAttributes } from "html-url-attributes";
import remarkParse from "remark-parse";
import type { Options as RemarkRehypeOptions } from "remark-rehype";
import remarkRehype from "remark-rehype";
import {
	createMemo,
	createRenderEffect,
	createSignal,
	createStore,
	reconcile,
} from "solid-js";
import { type PluggableList, unified } from "unified";
import type { Node } from "unist";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";
import { Fragment, jsx, jsxs } from "./jsx-runtime";
import type { Components, MarkdownResourceOptions, Options } from "./types";

const changelog =
	"https://github.com/remarkjs/react-markdown/blob/main/changelog.md";

const emptyPlugins: PluggableList = [];
const emptyRemarkRehypeOptions: Readonly<RemarkRehypeOptions> = {
	allowDangerousHtml: true,
};
const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;

type SyncOptions = {
	renderingStrategy?: "memo" | "reconcile" | null | undefined;
};

type MarkdownOptions = Options & SyncOptions;

type Deprecation = {
	from: string;
	id: string;
	to?: string;
};

const deprecations: ReadonlyArray<Readonly<Deprecation>> = [
	{ from: "astPlugins", id: "remove-buggy-html-in-markdown-parser" },
	{ from: "allowDangerousHtml", id: "remove-buggy-html-in-markdown-parser" },
	{
		from: "allowNode",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "allowElement",
	},
	{
		from: "allowedTypes",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "allowedElements",
	},
	{ from: "class", id: "remove-classname" },
	{ from: "className", id: "remove-classname" },
	{
		from: "disallowedTypes",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "disallowedElements",
	},
	{ from: "escapeHtml", id: "remove-buggy-html-in-markdown-parser" },
	{ from: "includeElementIndex", id: "#remove-includeelementindex" },
	{
		from: "includeNodeIndex",
		id: "change-includenodeindex-to-includeelementindex",
	},
	{ from: "linkTarget", id: "remove-linktarget" },
	{
		from: "plugins",
		id: "change-plugins-to-remarkplugins",
		to: "remarkPlugins",
	},
	{ from: "rawSourcePos", id: "#remove-rawsourcepos" },
	{ from: "renderers", id: "change-renderers-to-components", to: "components" },
	{ from: "source", id: "change-source-to-children", to: "children" },
	{ from: "sourcePos", id: "#remove-sourcepos" },
	{ from: "transformImageUri", id: "#add-urltransform", to: "urlTransform" },
	{ from: "transformLinkUri", id: "#add-urltransform", to: "urlTransform" },
];

export type {
	AllowElement,
	Components,
	ExtraProps,
	MarkdownResourceOptions,
	Options,
	UrlTransform,
} from "./types";

export default function Markdown(
	options: Readonly<MarkdownOptions>,
): JSX.Element {
	checkOptions(options);
	const processor = createMemo(() => createProcessor(options));
	const tree = createMemo(() => {
		const file = createFile(options);
		return processor().runSync(processor().parse(file), file);
	});
	const [reconciledTree, setReconciledTree] = createStore<Node>({
		type: "root",
		children: [],
	} as Node);

	createRenderEffect(
		() =>
			options.renderingStrategy === "reconcile" ? cloneTree(tree()) : undefined,
		(next) => {
			if (next) {
				setReconciledTree(reconcile(next));
			}
		},
	);

	const rendered = createMemo(() => {
		const nextTree =
			options.renderingStrategy === "reconcile"
				? cloneReconciledTree(reconciledTree as unknown as Node)
				: cloneTree(tree());

		return post(nextTree, options);
	});

	return <>{rendered()}</>;
}

export async function MarkdownAsync(
	options: Readonly<Options>,
): Promise<JSX.Element> {
	checkOptions(options);

	const processor = createProcessor(options);
	const file = createFile(options);
	const tree = await processor.run(processor.parse(file), file);

	// Defer the JSX build into the consuming render root: Solid 2 constructs
	// SSR elements against the current owner's hydration id, which exists only
	// inside a render root. Building the tree eagerly here (at await time,
	// outside any root) binds it to whatever ambient owner is active and throws
	// under SSR. Wrapping the call in a deferred child mirrors the sync path's
	// `<>{rendered()}</>` and keeps the return a valid `JSX.Element`.
	return <>{() => post(tree, options)}</>;
}

export function MarkdownResource(
	options: Readonly<MarkdownResourceOptions>,
): JSX.Element {
	checkOptions(options);

	const snapshot = createMemo<Options>(() => ({
		allowElement: options.allowElement,
		allowedElements: options.allowedElements,
		children: options.children,
		components: options.components,
		disallowedElements: options.disallowedElements,
		rehypePlugins: options.rehypePlugins,
		remarkPlugins: options.remarkPlugins,
		remarkRehypeOptions: options.remarkRehypeOptions,
		skipHtml: options.skipHtml,
		unwrapDisallowed: options.unwrapDisallowed,
		urlTransform: options.urlTransform,
	}));
	// Solid 2 gates signal writes inside an owned scope (the render effect
	// below); these two are intentionally written from it, so opt in.
	const [content, setContent] = createSignal<Node | undefined>(undefined, {
		ownedWrite: true,
	});
	const [resourceError, setResourceError] = createSignal<unknown>(undefined, {
		ownedWrite: true,
	});
	let requestId = 0;

	createRenderEffect(
		() => snapshot(),
		(currentOptions) => {
			const currentRequestId = ++requestId;

			setResourceError(undefined);

			void (async () => {
				try {
					const processor = createProcessor(currentOptions);
					const file = createFile(currentOptions);
					const tree = await processor.run(processor.parse(file), file);

					if (currentRequestId === requestId) {
						setContent(tree);
					}
				} catch (error) {
					if (currentRequestId === requestId) {
						setResourceError(error);
					}
				}
			})();
		},
	);

	const rendered = createMemo(() => {
		const error = resourceError();

		if (error) {
			throw error;
		}

		const tree = content();

		return tree ? post(cloneTree(tree), options) : (options.fallback ?? null);
	});

	return <>{rendered()}</>;
}

export function defaultUrlTransform(value: string): string {
	const colon = value.indexOf(":");
	const questionMark = value.indexOf("?");
	const numberSign = value.indexOf("#");
	const slash = value.indexOf("/");

	if (
		colon === -1 ||
		(slash !== -1 && colon > slash) ||
		(questionMark !== -1 && colon > questionMark) ||
		(numberSign !== -1 && colon > numberSign) ||
		safeProtocol.test(value.slice(0, colon))
	) {
		return value;
	}

	return "";
}

function createProcessor(options: Readonly<Options>) {
	const rehypePlugins = options.rehypePlugins || emptyPlugins;
	const remarkPlugins = options.remarkPlugins || emptyPlugins;
	const remarkRehypeOptions = options.remarkRehypeOptions
		? { ...options.remarkRehypeOptions, ...emptyRemarkRehypeOptions }
		: emptyRemarkRehypeOptions;

	return unified()
		.use(remarkParse)
		.use(remarkPlugins)
		.use(remarkRehype, remarkRehypeOptions)
		.use(rehypePlugins);
}

function createFile(options: Readonly<Options>): VFile {
	const children = options.children ?? "";
	const file = new VFile();

	if (typeof children === "string") {
		file.value = children;
		return file;
	}

	unreachable(
		`Unexpected value \`${String(children)}\` for \`children\` prop, expected \`string\``,
	);

	throw new TypeError("Unreachable");
}

function post(tree: Node, options: Readonly<Options>): JSX.Element {
	const allowedElements = options.allowedElements;
	const allowElement = options.allowElement;
	const components = options.components;
	const disallowedElements = options.disallowedElements;
	const skipHtml = options.skipHtml;
	const unwrapDisallowed = options.unwrapDisallowed;
	const urlTransform = options.urlTransform || defaultUrlTransform;

	if (allowedElements && disallowedElements) {
		unreachable(
			"Unexpected combined `allowedElements` and `disallowedElements`, expected one or the other",
		);
	}

	visit(tree, transform);

	return toJsxRuntime(tree as Nodes, {
		Fragment,
		components: components as Partial<Components>,
		elementAttributeNameCase: "html",
		ignoreInvalidStyle: true,
		jsx,
		jsxs,
		passKeys: true,
		passNode: true,
		stylePropertyNameCase: "css",
		tableCellAlignToStyle: true,
	});

	function transform(
		node: Node,
		index: number | undefined,
		parent: Parents | undefined,
	) {
		if (isRaw(node) && parent && typeof index === "number") {
			if (skipHtml) {
				parent.children.splice(index, 1);
			} else {
				parent.children[index] = { type: "text", value: node.value };
			}

			return index;
		}

		if (isElement(node)) {
			for (const key in urlAttributes) {
				if (hasOwn(urlAttributes, key) && hasOwn(node.properties, key)) {
					const value = node.properties[key];
					const test = urlAttributes[key as keyof typeof urlAttributes];

					if (test === null || test?.includes(node.tagName)) {
						node.properties[key] = urlTransform(String(value || ""), key, node);
					}
				}
			}
		}

		if (isElement(node)) {
			let remove = allowedElements
				? !allowedElements.includes(node.tagName)
				: disallowedElements
					? disallowedElements.includes(node.tagName)
					: false;

			if (!remove && allowElement && typeof index === "number") {
				remove = !allowElement(node, index, parent);
			}

			if (remove && parent && typeof index === "number") {
				if (unwrapDisallowed && node.children) {
					parent.children.splice(index, 1, ...node.children);
				} else {
					parent.children.splice(index, 1);
				}

				return index;
			}
		}
	}
}

function checkOptions(
	options: unknown,
): asserts options is Readonly<Record<string, unknown>> {
	for (const deprecation of deprecations) {
		if (hasOwn(options, deprecation.from)) {
			unreachable(
				`Unexpected \`${deprecation.from}\` prop, ${
					deprecation.to ? `use \`${deprecation.to}\` instead` : "remove it"
				} (see <${changelog}#${deprecation.id}> for more info)`,
			);
		}
	}
}

function cloneTree<T extends Node>(tree: T): T {
	return structuredClone(tree);
}

function cloneReconciledTree<T extends Node>(tree: T): T {
	return JSON.parse(JSON.stringify(tree)) as T;
}

function hasOwn(value: unknown, key: string): value is Record<string, unknown> {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function isElement(node: Node): node is Element {
	return node.type === "element";
}

function isRaw(node: Node): node is Node & { type: "raw"; value: string } {
	return node.type === "raw";
}

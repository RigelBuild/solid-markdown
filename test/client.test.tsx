import { afterEach, describe, expect, it, vi } from "bun:test";
import { render, waitFor } from "@solidjs/testing-library";
import type { JSX } from "@solidjs/web";
import type { Root } from "hast";
import rehypeStarryNight from "rehype-starry-night";
import remarkGfm from "remark-gfm";
import { Errored, createSignal } from "solid-js";
import type { Plugin } from "unified";
import Markdown, { MarkdownResource } from "../src";
import { deferPlugin, normalizeHtml } from "./helpers";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("solid-markdown (client)", () => {
	describe("core rendering", () => {
		it("renders markdown in the browser", () => {
			const result = render(() => <Markdown children="a" />);
			expect(result.container.innerHTML).toBe("<p>a</p>");
		});

		it("matches representative SSR output", () => {
			const markdown = "# a\n\n* b\n\n[a](https://example.com)";
			const result = render(() => <Markdown children={markdown} />);

			expect(normalizeHtml(result.container.innerHTML)).toBe(
				'<h1>a</h1>\n<ul>\n<li>b</li>\n</ul>\n<p><a href="https://example.com">a</a></p>',
			);
		});
	});

	describe("renderingStrategy compatibility", () => {
		it("renders correctly across memo and reconcile updates without warning", async () => {
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);
			let setValue!: (value: string) => void;
			let setStrategy!: (value: "memo" | "reconcile") => void;
			const result = render(() => {
				const [value, updateValue] = createSignal("*a*");
				const [strategy, updateStrategy] = createSignal<"memo" | "reconcile">(
					"memo",
				);

				setValue = updateValue;
				setStrategy = updateStrategy;

				return (
					<Markdown
						children={value()}
						remarkPlugins={[remarkGfm]}
						renderingStrategy={strategy()}
					/>
				);
			});

			expect(result.container.innerHTML).toBe("<p><em>a</em></p>");

			setValue("**b**");
			await waitFor(() => {
				expect(result.container.innerHTML).toBe("<p><strong>b</strong></p>");
			});

			setStrategy("reconcile");
			setValue("c");
			await waitFor(() => {
				expect(result.container.innerHTML).toBe("<p>c</p>");
			});

			render(() => <Markdown children="d" renderingStrategy="reconcile" />);

			expect(warn).not.toHaveBeenCalled();
		});

		// Characterizes the DOM-rebuild R1 turns on: under `reconcile`, #44's
		// renderer re-runs `post()` + `toJsxRuntime` over a fresh clone of the
		// reconciled tree on every changed tick, so `toJsxRuntime`'s eager DOM
		// build replaces node identity even for a subtree whose markup is
		// unchanged. This is deterministic — the signal drives Solid's
		// synchronous reactivity, no timers.
		it("rebuilds DOM node identity on a reconcile growth tick", async () => {
			let setValue!: (value: string) => void;
			const result = render(() => {
				const [value, updateValue] = createSignal("first paragraph");
				setValue = updateValue;
				return <Markdown children={value()} renderingStrategy="reconcile" />;
			});

			const firstParagraph = result.container.querySelector("p");
			expect(firstParagraph).not.toBeNull();
			expect(firstParagraph?.textContent).toBe("first paragraph");

			// Grow the source by one tick: append a second paragraph below the
			// first. The first paragraph's markup is unchanged.
			setValue("first paragraph\n\nsecond paragraph");
			await waitFor(() => {
				expect(result.container.querySelectorAll("p")).toHaveLength(2);
			});

			const rebuiltParagraph = result.container.querySelector("p");
			expect(rebuiltParagraph?.textContent).toBe("first paragraph");
			// The rebuild replaced the node: same markup, new DOM identity.
			expect(rebuiltParagraph).not.toBe(firstParagraph);
		});
	});

	describe("async behavior", () => {
		it("supports MarkdownResource fallback and resolution", async () => {
			const plugin = deferPlugin();
			const result = render(() => (
				<MarkdownResource
					children="a"
					fallback="Loading"
					rehypePlugins={[plugin.plugin]}
				/>
			));

			expect(result.container.innerHTML).toBe("Loading");

			plugin.resolve();

			await waitFor(() => {
				expect(result.container.innerHTML).toBe("<p>a</p>");
			});
		});

		it("supports async plugins in MarkdownResource", async () => {
			const plugin = deferPlugin();
			const result = render(() => (
				<MarkdownResource
					children={"```js\nconsole.log(3.14)\n```"}
					fallback="Loading"
					rehypePlugins={[plugin.plugin, rehypeStarryNight]}
				/>
			));

			expect(result.container.innerHTML).toBe("Loading");

			plugin.resolve();

			await waitFor(() => {
				expect(result.container.innerHTML).toContain('class="pl-en"');
				expect(result.container.innerHTML).toContain("console");
			});
		});

		it("surfaces initial MarkdownResource errors through ErrorBoundary", async () => {
			const plugin = deferPlugin();
			const result = render(() => (
				<Errored
					fallback={(error) => {
						const err = error();
						return (
							<span>
								Error: {err instanceof Error ? err.message : String(err)}
							</span>
						);
					}}
				>
					<MarkdownResource children="a" rehypePlugins={[plugin.plugin]} />
				</Errored>
			));

			expect(result.container.innerHTML).toBe("");

			plugin.reject(new Error("rejected"));

			await waitFor(() => {
				expect(result.container.innerHTML).toBe("<span>Error: rejected</span>");
			});
		});

		it("keeps the latest rerender when async work overlaps before first success", async () => {
			const pluginA = deferPlugin();
			const pluginB = deferPlugin();
			const harness = renderResourceHarness({
				children: "a",
				fallback: "Loading",
				plugin: pluginA.plugin,
			});

			expect(harness.result.container.innerHTML).toBe("Loading");

			harness.setChildren("b");
			harness.setPlugin(pluginB.plugin);

			expect(harness.result.container.innerHTML).toBe("Loading");

			pluginA.resolve();
			pluginB.resolve();

			await waitFor(() => {
				expect(harness.result.container.innerHTML).toBe("<p>b</p>");
			});
		});

		it("keeps previous content visible while a refresh is pending, then replaces it", async () => {
			const pluginA = deferPlugin();
			const pluginB = deferPlugin();
			const harness = renderResourceHarness({
				children: "a",
				fallback: "Loading",
				plugin: pluginA.plugin,
			});

			pluginA.resolve();

			await waitFor(() => {
				expect(harness.result.container.innerHTML).toBe("<p>a</p>");
			});

			harness.setChildren("b");
			harness.setPlugin(pluginB.plugin);

			expect(harness.result.container.innerHTML).toBe("<p>a</p>");

			pluginB.resolve();

			await waitFor(() => {
				expect(harness.result.container.innerHTML).toBe("<p>b</p>");
			});
		});

		it("supports switching from async to sync rendering after prior success", async () => {
			const plugin = deferPlugin();
			const harness = renderResourceHarness({
				children: "a",
				fallback: "Loading",
				plugin: plugin.plugin,
			});

			plugin.resolve();

			await waitFor(() => {
				expect(harness.result.container.innerHTML).toBe("<p>a</p>");
			});

			harness.setChildren("b");
			harness.setPlugin(undefined);

			await waitFor(() => {
				expect(harness.result.container.innerHTML).toBe("<p>b</p>");
			});
		});

		it("supports empty markdown rerenders", async () => {
			const harness = renderResourceHarness({ children: "a" });

			await waitFor(() => {
				expect(harness.result.container.innerHTML).toBe("<p>a</p>");
			});

			harness.setChildren("");

			await waitFor(() => {
				expect(harness.result.container.innerHTML).toBe("");
			});
		});
	});
});

function renderResourceHarness(initial: {
	children: string;
	fallback?: JSX.Element;
	plugin?: Plugin<[], Root>;
}) {
	let setChildren!: (value: string) => void;
	let setFallback!: (value: JSX.Element | undefined) => void;
	let setPlugin!: (value: Plugin<[], Root> | undefined) => void;

	const result = render(() => {
		const [children, updateChildren] = createSignal(initial.children);
		const [fallback, updateFallback] = createSignal(initial.fallback);
		const [plugin, updatePlugin] = createSignal<{
			value: Plugin<[], Root> | undefined;
		}>({ value: initial.plugin });

		setChildren = updateChildren;
		setFallback = updateFallback;
		setPlugin = (value) => updatePlugin({ value });

		const activePlugin = plugin().value;
		return (
			<MarkdownResource
				children={children()}
				fallback={fallback()}
				rehypePlugins={activePlugin ? [activePlugin] : []}
			/>
		);
	});

	return { result, setChildren, setFallback, setPlugin };
}

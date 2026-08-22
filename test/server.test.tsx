import { describe, expect, it } from "bun:test";
import { type JSX, renderToStream } from "@solidjs/web";
import type { RootContent } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeStarryNight from "rehype-starry-night";
import remarkGfm from "remark-gfm";
import remarkToc from "remark-toc";
import type { Component } from "solid-js";
import { visit } from "unist-util-visit";
import Markdown, { MarkdownAsync, defaultUrlTransform } from "../src";
import { prependNodes, readStream, renderSync } from "./helpers";

describe("solid-markdown (server)", () => {
	it("exposes the public api", async () => {
		const keys = Object.keys(await import("../src"))
			// Vite's SSR transform injects internal `$$`-prefixed bindings
			// (e.g. `$$moduleUrl`); they are not part of the package surface.
			.filter((key) => !key.startsWith("$$"))
			.sort();
		expect(keys).toEqual([
			"MarkdownAsync",
			"MarkdownResource",
			"default",
			"defaultUrlTransform",
		]);
	});

	describe("core rendering", () => {
		it("renders basic markdown and nullish children", () => {
			expect(renderSync(() => <Markdown>a</Markdown>)).toBe("<p>a</p>");
			expect(renderSync(() => <Markdown children={null} />)).toBe("");
			expect(renderSync(() => <Markdown children={undefined} />)).toBe("");
		});

		it("throws on invalid children", () => {
			expect(() =>
				renderSync(() => <Markdown children={1 as never} />),
			).toThrow(/Unexpected value `1` for `children` prop, expected `string`/);
			expect(() =>
				renderSync(() => <Markdown children={true as never} />),
			).toThrow(
				/Unexpected value `true` for `children` prop, expected `string`/,
			);
		});

		it("supports markdown syntax parity cases", () => {
			expect(renderSync(() => <Markdown children="> a" />)).toBe(
				"<blockquote>\n<p>a</p>\n</blockquote>",
			);
			expect(renderSync(() => <Markdown children={"a\\\nb"} />)).toBe(
				"<p>a<br />\nb</p>",
			);
			expect(renderSync(() => <Markdown children="    a" />)).toBe(
				"<pre><code>a\n</code></pre>",
			);
			expect(renderSync(() => <Markdown children={"```js\na\n```"} />)).toBe(
				'<pre><code class="language-js">a\n</code></pre>',
			);
			expect(
				renderSync(() => (
					<Markdown children="~a~" remarkPlugins={[remarkGfm]} />
				)),
			).toBe("<p><del>a</del></p>");
			expect(renderSync(() => <Markdown children="*a*" />)).toBe(
				"<p><em>a</em></p>",
			);
			expect(renderSync(() => <Markdown children="# a" />)).toBe("<h1>a</h1>");
			expect(renderSync(() => <Markdown children="`a`" />)).toBe(
				"<p><code>a</code></p>",
			);
			expect(renderSync(() => <Markdown children="* a" />)).toBe(
				"<ul>\n<li>a</li>\n</ul>",
			);
			expect(renderSync(() => <Markdown children="1. a" />)).toBe(
				"<ol>\n<li>a</li>\n</ol>",
			);
			expect(renderSync(() => <Markdown children="**a**" />)).toBe(
				"<p><strong>a</strong></p>",
			);
			expect(renderSync(() => <Markdown children="***" />)).toBe("<hr />");
		});

		it("supports footnotes, images, links, and definitions", () => {
			expect(
				renderSync(() => (
					<Markdown children={"a[^x]\n\n[^x]: y"} remarkPlugins={[remarkGfm]} />
				)),
			).toContain('href="#user-content-fn-x"');
			expect(renderSync(() => <Markdown children="![a](b)" />)).toBe(
				'<p><img src="b" alt="a"/></p>',
			);
			expect(renderSync(() => <Markdown children="![a](b (c))" />)).toBe(
				'<p><img src="b" alt="a" title="c"/></p>',
			);
			expect(renderSync(() => <Markdown children={"![a]\n\n[a]: b"} />)).toBe(
				'<p><img src="b" alt="a"/></p>',
			);
			expect(renderSync(() => <Markdown children="[a](b)" />)).toBe(
				'<p><a href="b">a</a></p>',
			);
			expect(renderSync(() => <Markdown children="[a](b (c))" />)).toBe(
				'<p><a href="b" title="c">a</a></p>',
			);
			expect(renderSync(() => <Markdown children={"[a]\n\n[a]: b"} />)).toBe(
				'<p><a href="b">a</a></p>',
			);
			expect(
				renderSync(() => (
					<Markdown
						children={
							"[][__proto__] [][constructor]\n\n[__proto__]: a\n[constructor]: b"
						}
					/>
				)),
			).toBe('<p><a href="a"></a> <a href="b"></a></p>');
			expect(
				renderSync(() => <Markdown children={"[a][]\n\n[a]: b\n[a]: c"} />),
			).toBe('<p><a href="b">a</a></p>');
		});

		it("supports raw html behavior and tables", () => {
			expect(renderSync(() => <Markdown children="<i>a</i>" />)).toBe(
				"<p>&lt;i>a&lt;/i></p>",
			);
			expect(
				renderSync(() => (
					<Markdown children="<i>a</i>" rehypePlugins={[rehypeRaw]} />
				)),
			).toBe("<p><i>a</i></p>");
			expect(
				renderSync(() => <Markdown children="a<i>b</i>c" skipHtml />),
			).toBe("<p>abc</p>");
			expect(
				renderSync(() => (
					<Markdown
						children={"| a |\n| - |\n| b |"}
						remarkPlugins={[remarkGfm]}
					/>
				)),
			).toBe(
				"<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>",
			);
			expect(
				renderSync(() => (
					<Markdown
						children={"| a | b | c | d |\n| :- | :-: | -: | - |"}
						remarkPlugins={[remarkGfm]}
					/>
				)),
			).toBe(
				'<table><thead><tr><th style="text-align:left">a</th><th style="text-align:center">b</th><th style="text-align:right">c</th><th>d</th></tr></thead></table>',
			);
		});
	});

	describe("url safety", () => {
		it("supports safe URLs and sanitizes unsafe ones", () => {
			expect(renderSync(() => <Markdown children="[](/a)" />)).toBe(
				'<p><a href="/a"></a></p>',
			);
			expect(renderSync(() => <Markdown children="[](http://a.com)" />)).toBe(
				'<p><a href="http://a.com"></a></p>',
			);
			expect(renderSync(() => <Markdown children="[](HTTPS://A.COM)" />)).toBe(
				'<p><a href="HTTPS://A.COM"></a></p>',
			);
			expect(
				renderSync(() => <Markdown children="[](javascript:alert(1))" />),
			).toBe("<p><a href></a></p>");
			expect(
				renderSync(() => <Markdown children="[](vbscript:alert(1))" />),
			).toBe("<p><a href></a></p>");
			expect(
				renderSync(() => <Markdown children="[](VBSCRIPT:alert(1))" />),
			).toBe("<p><a href></a></p>");
			expect(
				renderSync(() => <Markdown children="[](file:///etc/passwd)" />),
			).toBe("<p><a href></a></p>");
			expect(renderSync(() => <Markdown children="[]()" />)).toBe(
				"<p><a href></a></p>",
			);
			expect(
				renderSync(() => <Markdown children="[](a?javascript:alert(1))" />),
			).toBe('<p><a href="a?javascript:alert(1)"></a></p>');
			expect(renderSync(() => <Markdown children="[](a?b&c=d)" />)).toBe(
				'<p><a href="a?b&amp;c=d"></a></p>',
			);
			expect(
				renderSync(() => <Markdown children="[](a#javascript:alert(1))" />),
			).toBe('<p><a href="a#javascript:alert(1)"></a></p>');
		});

		it("supports urlTransform for href, empty URLs, and src", () => {
			expect(
				renderSync(() => (
					<Markdown
						children="[a](https://b.com 'c')"
						urlTransform={(url, key, node) => {
							expect(url).toBe("https://b.com");
							expect(key).toBe("href");
							expect(node.tagName).toBe("a");
							return "";
						}}
					/>
				)),
			).toBe('<p><a href title="c">a</a></p>');
			expect(
				renderSync(() => (
					<Markdown
						children="[]()"
						urlTransform={(url, key, node) => {
							expect(url).toBe("");
							expect(key).toBe("href");
							expect(node.tagName).toBe("a");
							return "";
						}}
					/>
				)),
			).toBe("<p><a href></a></p>");
			expect(
				renderSync(() => (
					<Markdown
						children="![a](https://b.com 'c')"
						urlTransform={(url, key, node) => {
							expect(url).toBe("https://b.com");
							expect(key).toBe("src");
							expect(node.tagName).toBe("img");
							return null;
						}}
					/>
				)),
			).toBe('<p><img alt="a" title="c"/></p>');
		});

		it("covers defaultUrlTransform edge cases directly", () => {
			expect(defaultUrlTransform("javascript:alert(1)")).toBe("");
			expect(defaultUrlTransform("vbscript:alert(1)")).toBe("");
			expect(defaultUrlTransform("file:///etc/passwd")).toBe("");
			expect(defaultUrlTransform("HTTPS://A.COM")).toBe("HTTPS://A.COM");
			expect(defaultUrlTransform("/a")).toBe("/a");
			expect(defaultUrlTransform("a?javascript:alert(1)")).toBe(
				"a?javascript:alert(1)",
			);
		});
	});

	describe("removed props", () => {
		it("throws for removed props with migration messages", () => {
			const cases: ReadonlyArray<[string, Record<string, unknown>, RegExp]> = [
				[
					"source",
					{ source: "a" },
					/Unexpected `source` prop, use `children` instead/,
				],
				[
					"class",
					{ class: "markdown-body", children: "a" },
					/Unexpected `class` prop, remove it/,
				],
				[
					"className",
					{ className: "markdown-body", children: "a" },
					/Unexpected `className` prop, remove it/,
				],
				[
					"allowDangerousHtml",
					{ allowDangerousHtml: true, children: "a" },
					/Unexpected `allowDangerousHtml` prop, remove it/,
				],
				[
					"plugins",
					{ plugins: [], children: "a" },
					/Unexpected `plugins` prop, use `remarkPlugins` instead/,
				],
				[
					"renderers",
					{ renderers: {}, children: "a" },
					/Unexpected `renderers` prop, use `components` instead/,
				],
				[
					"allowNode",
					{ allowNode: () => true, children: "a" },
					/Unexpected `allowNode` prop, use `allowElement` instead/,
				],
				[
					"allowedTypes",
					{ allowedTypes: ["p"], children: "a" },
					/Unexpected `allowedTypes` prop, use `allowedElements` instead/,
				],
				[
					"disallowedTypes",
					{ disallowedTypes: ["em"], children: "a" },
					/Unexpected `disallowedTypes` prop, use `disallowedElements` instead/,
				],
				[
					"linkTarget",
					{ linkTarget: "_blank", children: "a" },
					/Unexpected `linkTarget` prop, remove it/,
				],
				[
					"transformImageUri",
					{ transformImageUri: () => "", children: "a" },
					/Unexpected `transformImageUri` prop, use `urlTransform` instead/,
				],
				[
					"transformLinkUri",
					{ transformLinkUri: () => "", children: "a" },
					/Unexpected `transformLinkUri` prop, use `urlTransform` instead/,
				],
				[
					"includeElementIndex",
					{ includeElementIndex: true, children: "a" },
					/Unexpected `includeElementIndex` prop, remove it/,
				],
				[
					"rawSourcePos",
					{ rawSourcePos: true, children: "a" },
					/Unexpected `rawSourcePos` prop, remove it/,
				],
				[
					"sourcePos",
					{ sourcePos: true, children: "a" },
					/Unexpected `sourcePos` prop, remove it/,
				],
			];

			for (const [name, props, expected] of cases) {
				expect(() => renderWithProps(props), name).toThrow(expected);
			}
		});
	});

	describe("components", () => {
		it("supports replacing tags and generic component functions", () => {
			expect(
				renderSync(() => <Markdown children="# a" components={{ h1: "h2" }} />),
			).toBe("<h2>a</h2>");
			expect(
				renderSync(() => (
					<Markdown
						children="a"
						components={{
							p(props) {
								const { node, ...rest } = props;
								expect(node?.tagName).toBe("p");
								expect(rest).toEqual({ children: "a" });
								return <div {...rest} />;
							},
						}}
					/>
				)),
			).toBe("<div>a</div>");
		});

		it("throws on an invalid component override", () => {
			expect(() =>
				renderWithProps({
					children: "# a",
					components: { h1: 123 },
				}),
			).toThrow(/Comp is not a function/);
		});

		it("passes node to component overrides for headings, code, list, and table tags", () => {
			let headingCalls = 0;
			let codeCalls = 0;
			let liCalls = 0;
			let olCalls = 0;
			let ulCalls = 0;
			let trCalls = 0;
			let tdCalls = 0;
			let thCalls = 0;

			expect(
				renderSync(() => (
					<Markdown
						children={
							"# a\n## b\n\n```x\nc\n```\n\n* [x] a\n1. b\n\n|h|\n|-|\n|d|"
						}
						components={{
							h1(props) {
								headingCalls += 1;
								expect(props.node?.tagName).toBe("h1");
								return <h1>{props.children}</h1>;
							},
							h2(props) {
								headingCalls += 1;
								expect(props.node?.tagName).toBe("h2");
								return <h2>{props.children}</h2>;
							},
							code(props) {
								codeCalls += 1;
								expect(props.node?.tagName).toBe("code");
								return <code>{props.children}</code>;
							},
							li(props) {
								liCalls += 1;
								expect(props.node?.tagName).toBe("li");
								return <li>{props.children}</li>;
							},
							ol(props) {
								olCalls += 1;
								expect(props.node?.tagName).toBe("ol");
								return <ol>{props.children}</ol>;
							},
							ul(props) {
								ulCalls += 1;
								expect(props.node?.tagName).toBe("ul");
								return <ul>{props.children}</ul>;
							},
							tr(props) {
								trCalls += 1;
								expect(props.node?.tagName).toBe("tr");
								return <tr>{props.children}</tr>;
							},
							td(props) {
								tdCalls += 1;
								expect(props.node?.tagName).toBe("td");
								return <td>{props.children}</td>;
							},
							th(props) {
								thCalls += 1;
								expect(props.node?.tagName).toBe("th");
								return <th>{props.children}</th>;
							},
						}}
						remarkPlugins={[remarkGfm]}
					/>
				)),
			).toContain("<table>");

			expect(headingCalls).toBe(2);
			expect(codeCalls).toBe(1);
			expect(liCalls).toBe(2);
			expect(olCalls).toBe(1);
			expect(ulCalls).toBe(1);
			expect(trCalls).toBe(2);
			expect(tdCalls).toBe(1);
			expect(thCalls).toBe(1);
		});
	});

	describe("plugin and property passthrough", () => {
		it("supports allow/disallow filters and unwrapDisallowed", () => {
			expect(
				renderSync(() => (
					<Markdown
						children={"# *a*\n* b"}
						allowedElements={["h1", "li", "ul"]}
					/>
				)),
			).toBe("<h1></h1>\n<ul>\n<li>b</li>\n</ul>");
			expect(
				renderSync(() => (
					<Markdown
						children="*a* **b**"
						allowElement={(element) => element.tagName !== "em"}
					/>
				)),
			).toBe("<p> <strong>b</strong></p>");
			expect(
				renderSync(() => (
					<Markdown children={"# *a*\n* b"} disallowedElements={["em"]} />
				)),
			).toBe("<h1></h1>\n<ul>\n<li>b</li>\n</ul>");
			expect(
				renderSync(() => (
					<Markdown
						children="# *a*"
						unwrapDisallowed
						allowedElements={["h1"]}
					/>
				)),
			).toBe("<h1>a</h1>");
			expect(
				renderSync(() => (
					<Markdown
						children="# *a*"
						unwrapDisallowed
						disallowedElements={["em"]}
					/>
				)),
			).toBe("<h1>a</h1>");
			expect(() =>
				renderSync(() => (
					<Markdown
						children=""
						allowedElements={["p"]}
						disallowedElements={["a"]}
					/>
				)),
			).toThrow(
				/Unexpected combined `allowedElements` and `disallowedElements`, expected one or the other/,
			);
		});

		it("supports remarkRehypeOptions and other remark plugins", () => {
			expect(
				renderSync(() => (
					<Markdown
						children={"[^x]\n\n[^x]: a\n\n"}
						remarkPlugins={[remarkGfm]}
						remarkRehypeOptions={{ clobberPrefix: "b-" }}
					/>
				)),
			).toContain('href="#b-fn-x"');
			expect(
				renderSync(() => (
					<Markdown
						children={"# a\n## Contents\n## b\n### c\n## d"}
						remarkPlugins={[remarkToc]}
					/>
				)),
			).toBe(`<h1>a</h1>
<h2>Contents</h2>
<ul>
<li><a href="#b">b</a>
<ul>
<li><a href="#c">c</a></li>
</ul>
</li>
<li><a href="#d">d</a></li>
</ul>
<h2>b</h2>
<h3>c</h3>
<h2>d</h2>`);
		});

		it("supports aria, data, comma-separated, style, svg, and comment plugin output", () => {
			expect(
				renderSync(() => (
					<Markdown
						children="c"
						rehypePlugins={[
							prependNodes({
								type: "element",
								tagName: "input",
								properties: { id: "a", ariaDescribedBy: ["b"], required: true },
								children: [],
							}),
						]}
					/>
				)),
			).toBe('<input id="a" aria-describedby="b" required/><p>c</p>');
			expect(
				renderSync(() => (
					<Markdown
						children="b"
						rehypePlugins={[
							prependNodes({
								type: "element",
								tagName: "i",
								properties: { dataWhatever: "a", dataIgnoreThis: undefined },
								children: [],
							}),
						]}
					/>
				)),
			).toBe('<i data-whatever="a"></i><p>b</p>');
			expect(
				renderSync(() => (
					<Markdown
						children="c"
						rehypePlugins={[
							prependNodes({
								type: "element",
								tagName: "i",
								properties: { accept: ["a", "b"] },
								children: [],
							}),
						]}
					/>
				)),
			).toBe('<i accept="a, b"></i><p>c</p>');
			expect(
				renderSync(() => (
					<Markdown
						children="a"
						rehypePlugins={[
							prependNodes({
								type: "element",
								tagName: "i",
								properties: { style: "color: red; font-weight: bold" },
								children: [],
							}),
						]}
					/>
				)),
			).toBe('<i style="color:red;font-weight:bold"></i><p>a</p>');
			expect(
				renderSync(() => (
					<Markdown
						children="a"
						rehypePlugins={[
							prependNodes({
								type: "element",
								tagName: "i",
								properties: { style: "-ms-b: 1; -webkit-c: 2" },
								children: [],
							}),
						]}
					/>
				)),
			).toBe('<i style="-ms-b:1;-webkit-c:2"></i><p>a</p>');
			expect(
				renderSync(() => (
					<Markdown
						children="a"
						rehypePlugins={[
							prependNodes({
								type: "element",
								tagName: "i",
								properties: { style: "broken" },
								children: [],
							}),
						]}
					/>
				)),
			).toBe('<i style=""></i><p>a</p>');
			expect(
				renderSync(() => (
					<Markdown
						children="a"
						rehypePlugins={[
							prependNodes({
								type: "element",
								tagName: "svg",
								properties: {
									viewBox: "0 0 500 500",
									xmlns: "http://www.w3.org/2000/svg",
								},
								children: [
									{
										type: "element",
										tagName: "title",
										properties: {},
										children: [
											{ type: "text", value: "SVG `<circle>` element" },
										],
									},
									{
										type: "element",
										tagName: "circle",
										properties: { cx: "120", cy: "120", r: "100" },
										children: [],
									},
									{
										type: "element",
										tagName: "path",
										properties: { strokeMiterLimit: -1 },
										children: [],
									},
								],
							}),
						]}
					/>
				)),
			).toBe(
				'<svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg"><title>SVG `&lt;circle>` element</title><circle cx="120" cy="120" r="100"></circle><path stroke-miterlimit="-1"></path></svg><p>a</p>',
			);
			expect(
				renderSync(() => (
					<Markdown
						children="a"
						rehypePlugins={[
							prependNodes({ type: "comment", value: "things!" } as never),
						]}
					/>
				)),
			).toBe("<p>a</p>");
		});

		it("merges table cell style with alignment", () => {
			expect(
				renderSync(() => (
					<Markdown
						children={"| a |\n| :- |"}
						remarkPlugins={[remarkGfm]}
						rehypePlugins={[
							function plugin() {
								return (tree) => {
									visit(tree, "element", (node) => {
										if (node.tagName === "th") {
											node.properties = {
												...node.properties,
												style: "color: red",
											};
										}
									});
								};
							},
						]}
					/>
				)),
			).toBe(
				'<table><thead><tr><th style="color:red;text-align:left">a</th></tr></thead></table>',
			);
		});

		it("returns empty output when a plugin replaces the root", () => {
			expect(
				renderSync(() => (
					<Markdown
						children="a"
						rehypePlugins={[
							function plugin() {
								return () => ({ type: "comment", value: "things!" });
							},
						]}
					/>
				)),
			).toBe("");
		});
	});

	describe("async behavior", () => {
		it("supports MarkdownAsync with SSR and streaming", async () => {
			const rendered = await MarkdownAsync({ children: "a" });

			expect(renderSync(() => rendered)).toBe("<p>a</p>");
			expect(await readStream(renderToStream(() => rendered))).toBe("<p>a</p>");
		});

		it("supports async plugins in MarkdownAsync", async () => {
			const rendered = await MarkdownAsync({
				children: "```js\nconsole.log(3.14)\n```",
				rehypePlugins: [rehypeStarryNight],
			});
			const html = renderSync(() => rendered);

			expect(html).toContain('<span class="pl-en">console</span>');
			expect(html).toContain('<span class="pl-c1">3.14</span>');
		});
	});
});

function renderWithProps(props: Record<string, unknown>): string {
	const MarkdownAny = Markdown as unknown as Component<Record<string, unknown>>;
	return renderSync(() => <MarkdownAny {...props} />);
}

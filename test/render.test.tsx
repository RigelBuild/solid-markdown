import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { SolidMarkdown } from "../src/index";

const mount = (ui: () => any) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const dispose = render(ui, container);
	flush();
	return { container, dispose };
};

describe("SolidMarkdown (solid-js 2)", () => {
	it("renders basic markdown to DOM with the default memo strategy", () => {
		const { container, dispose } = mount(() => (
			<SolidMarkdown children={"# Hello\n\nsome **bold** text"} />
		));

		expect(container.querySelector("h1")?.textContent).toBe("Hello");
		expect(container.querySelector("strong")?.textContent).toBe("bold");
		dispose();
	});

	it("renders lists and links", () => {
		const { container, dispose } = mount(() => (
			<SolidMarkdown children={"- a\n- b\n\n[link](https://example.com)"} />
		));

		expect(container.querySelectorAll("li")).toHaveLength(2);
		const anchor = container.querySelector("a");
		expect(anchor?.getAttribute("href")).toBe("https://example.com");
		dispose();
	});

	it("updates output reactively under the reconcile strategy (v2 owned-write path)", () => {
		const [md, setMd] = createSignal("# First");
		const { container, dispose } = mount(() => (
			<SolidMarkdown renderingStrategy="reconcile" children={md()} />
		));

		expect(container.querySelector("h1")?.textContent).toBe("First");

		setMd("## Second");
		flush();

		expect(container.querySelector("h1")).toBeNull();
		expect(container.querySelector("h2")?.textContent).toBe("Second");
		dispose();
	});
});

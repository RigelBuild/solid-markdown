import { describe, expect, test } from "bun:test";
import type { Element, Root } from "hast";
import {
	flattenPosition,
	getElementsBeforeCount,
	getInputElement,
} from "./utils";

const el = (tagName: string, children: Element["children"] = []): Element => ({
	type: "element",
	tagName,
	properties: {},
	children,
});

const root = (children: Root["children"]): Root => ({
	type: "root",
	children,
});

describe("flattenPosition", () => {
	test("joins start/end line:column into a single string", () => {
		expect(
			flattenPosition({
				start: { line: 1, column: 2, offset: 0 },
				end: { line: 3, column: 4, offset: 10 },
			}),
		).toBe("1:2-3:4");
	});

	test("renders null coordinates as the literal 'null'", () => {
		expect(
			flattenPosition({
				start: { line: null, column: null, offset: null },
				end: { line: null, column: null, offset: null },
			}),
		).toBe("null:null-null:null");
	});
});

describe("getInputElement", () => {
	test("returns the first input child", () => {
		const input = el("input");
		expect(getInputElement(root([el("span"), input, el("input")]))).toBe(input);
	});

	test("returns null when no input child exists", () => {
		expect(getInputElement(root([el("span"), el("div")]))).toBeNull();
	});
});

describe("getElementsBeforeCount", () => {
	test("counts element siblings before the target node", () => {
		const target = el("em");
		const parent = el("p", [el("span"), el("strong"), target, el("span")]);
		expect(getElementsBeforeCount(parent, target)).toBe(2);
	});

	test("counts all element children when the target is absent", () => {
		const parent = el("p", [el("span"), el("strong")]);
		expect(getElementsBeforeCount(parent)).toBe(2);
	});
});

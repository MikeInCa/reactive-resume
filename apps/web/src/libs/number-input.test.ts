import { describe, expect, it } from "vitest";
import { numberInputValue, readNumberInput } from "./number-input";

describe("readNumberInput", () => {
	it("returns NaN for an empty value so the control can be cleared without persisting", () => {
		expect(readNumberInput("", { min: 0.5, max: 4 })).toBeNaN();
	});

	it("returns NaN for an unparsable value", () => {
		expect(readNumberInput("abc", { min: 0.5, max: 4 })).toBeNaN();
		expect(readNumberInput("1e400", { min: 0.5, max: 4 })).toBeNaN();
	});

	it("keeps an in-range value as typed", () => {
		expect(readNumberInput("1.5", { min: 0.5, max: 4 })).toBe(1.5);
		expect(readNumberInput("4", { min: 0.5, max: 4 })).toBe(4);
	});

	it("clamps a value above max (the line-height regression: 12 typed into a field capped at 4)", () => {
		expect(readNumberInput("12", { min: 0.5, max: 4 })).toBe(4);
	});

	it("clamps a value below min", () => {
		expect(readNumberInput("0", { min: 0.5, max: 4 })).toBe(0.5);
		expect(readNumberInput("-3", { min: 0 })).toBe(0);
	});

	it("applies only the bounds given", () => {
		expect(readNumberInput("999", { min: 0 })).toBe(999);
		expect(readNumberInput("-1", { max: 10 })).toBe(-1);
		expect(readNumberInput("7")).toBe(7);
	});
});

describe("numberInputValue", () => {
	it("renders a finite number as itself and NaN as an empty string", () => {
		expect(numberInputValue(2)).toBe(2);
		expect(numberInputValue(Number.NaN)).toBe("");
	});
});

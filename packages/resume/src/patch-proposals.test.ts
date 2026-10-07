import { describe, expect, it } from "vitest";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { contentPathProblem, normalizePatchPaths } from "./patch-proposals";

describe("normalizePatchPaths", () => {
	it("strips a /data prefix and expands a section shortcut, on path and from", () => {
		const ops = normalizePatchPaths(defaultResumeData, [
			{ op: "replace", path: "/data/basics/headline", value: "x" },
			{ op: "replace", path: "/experience/items/0/position", value: "y" },
			{ op: "move", from: "/data/skills/items/2", path: "/skills/items/0" },
			{ op: "replace", path: "/sections/skills/items/0/name", value: "z" },
		]);
		expect(ops.map((op) => op.path)).toEqual([
			"/basics/headline",
			"/sections/experience/items/0/position",
			"/sections/skills/items/0",
			"/sections/skills/items/0/name",
		]);
		expect((ops[2] as { from: string }).from).toBe("/sections/skills/items/2");
	});
});

describe("contentPathProblem", () => {
	it("allows content paths", () => {
		for (const path of [
			"/basics/headline",
			"/basics/website/url",
			"/basics/customFields/0/text",
			"/summary/content",
			"/sections/experience/items/0/position",
			"/sections/experience/items/0/dates",
			"/sections/experience/items/0/dates/end",
			"/sections/experience/items/0/hidden",
			"/sections/experience/items/0/roles/1/description",
			"/sections/skills/items/-",
			"/sections/skills/items/2",
			"/customSections/0/items/1/name",
		])
			expect(contentPathProblem(path), path).toBeNull();
	});

	it("refuses design, section settings and generated date text, each with a reason", () => {
		expect(contentPathProblem("/metadata/template")).toMatch(/design/i);
		expect(contentPathProblem("/picture/url")).toMatch(/picture/i);
		expect(contentPathProblem("/sections/experience/title")).toMatch(/section setting/i);
		expect(contentPathProblem("/sections/experience/hidden")).toMatch(/section setting/i);
		expect(contentPathProblem("/summary/hidden")).toMatch(/section setting/i);
		expect(contentPathProblem("/customSections/0/title")).toMatch(/section setting/i);
		expect(contentPathProblem("/sections/experience/items/0/period")).toMatch(/dates/);
		expect(contentPathProblem("/sections/awards/items/0/date")).toMatch(/dates/);
		expect(contentPathProblem("")).toMatch(/whole/i);
		expect(contentPathProblem("/sections")).toMatch(/whole/i);
	});
});

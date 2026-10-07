import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { experienceItemSchema, skillItemSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	applyPatchTo,
	contentPathProblem,
	describeChanges,
	normalizePatchPaths,
	resolvePatchProposal,
	targetOf,
	withPreconditions,
} from "./patch-proposals";

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

function sample(): ResumeData {
	const d = structuredClone(defaultResumeData);
	d.basics.headline = "Junior Designer";
	d.sections.experience.items = [
		experienceItemSchema.parse({
			id: "kettle",
			hidden: false,
			company: "Studio Kettle",
			position: "Junior Designer",
			location: "Lisbon",
			period: "",
			dates: { start: "2016-01", end: "2019-06", present: false },
			description: "<p>Did things.</p>",
			website: { url: "", label: "" },
			roles: [],
		}),
	];
	d.sections.skills.items = [
		skillItemSchema.parse({
			id: "s1",
			hidden: false,
			name: "Figma",
			proficiency: "",
			level: 3,
			keywords: [],
			icon: "",
			iconColor: "",
		}),
		skillItemSchema.parse({
			id: "s2",
			hidden: false,
			name: "Sketch",
			proficiency: "",
			level: 2,
			keywords: [],
			icon: "",
			iconColor: "",
		}),
	];
	return d;
}
const labels = {
	sectionTitle: (id: string) => id.charAt(0).toUpperCase() + id.slice(1),
	entryTitle: (e: Record<string, unknown>) => String(e.company ?? e.name ?? ""),
};

describe("withPreconditions", () => {
	it("tests the current value before a replace or remove, the source before a move, and the neighbour before an indexed add", () => {
		const d = sample();
		const ops = withPreconditions(d, [
			{ op: "replace", path: "/basics/headline", value: "Product Designer" },
			{ op: "remove", path: "/sections/skills/items/1" },
			{ op: "move", from: "/sections/skills/items/1", path: "/sections/skills/items/0" },
			{ op: "add", path: "/sections/skills/items/0", value: { id: "s3", name: "Terraform" } },
			{ op: "add", path: "/sections/skills/items/-", value: { id: "s4", name: "Go" } },
		]);
		expect(ops.filter((op) => op.op === "test").map((op) => op.path)).toEqual([
			"/basics/headline",
			"/sections/skills/items/1",
			"/sections/skills/items/0",
		]);
		expect(ops[0]).toEqual({ op: "test", path: "/basics/headline", value: "Junior Designer" });
		expect(ops.at(-1)).toEqual({ op: "add", path: "/sections/skills/items/-", value: { id: "s4", name: "Go" } });
	});
});

describe("describeChanges and targetOf", () => {
	it("labels a field, an added entry, a removed entry, a move and a dates change", () => {
		const before = sample();
		const after = structuredClone(before);
		after.basics.headline = "Product Designer";
		const entry = after.sections.experience.items[0];
		if (!entry) throw new Error("fixture");
		entry.position = "Product Designer";
		entry.dates = { start: "2016-01", end: null, present: true };
		const [figma, sketch] = after.sections.skills.items;
		if (!figma || !sketch) throw new Error("fixture");
		after.sections.skills.items = [sketch, { ...figma, id: "s3", name: "Terraform" }];
		const rows = describeChanges(
			before,
			after,
			[
				{ op: "replace", path: "/basics/headline", value: "Product Designer" },
				{ op: "replace", path: "/sections/experience/items/0/position", value: "Product Designer" },
				{ op: "replace", path: "/sections/experience/items/0/dates", value: entry.dates },
				{ op: "add", path: "/sections/skills/items/-", value: { id: "s3", name: "Terraform" } },
				{ op: "remove", path: "/sections/skills/items/0" },
				{ op: "move", from: "/sections/skills/items/1", path: "/sections/skills/items/0" },
			],
			labels,
		);
		expect(rows).toEqual([
			{ path: "/basics/headline", label: "Basics · Headline", before: "Junior Designer", after: "Product Designer" },
			{
				path: "/sections/experience/items/0/position",
				label: "Experience · Studio Kettle · Position",
				before: "Junior Designer",
				after: "Product Designer",
			},
			{
				path: "/sections/experience/items/0/dates",
				label: "Experience · Studio Kettle · Dates",
				before: "2016-01 – 2019-06",
				after: "2016-01 – Present",
			},
			{ path: "/sections/skills/items/-", label: "Skills", before: "", after: "Add entry “Terraform”" },
			{ path: "/sections/skills/items/0", label: "Skills", before: "Remove entry “Figma”", after: "" },
			{ path: "/sections/skills/items/0", label: "Skills", before: "", after: "Move “Sketch” to position 1" },
		]);
		expect(targetOf("/sections/experience/items/0/roles/1/description")).toMatchObject({
			sectionId: "experience",
			field: "description",
		});
		expect(targetOf("/sections/experience/items/0/position", sample())).toEqual({
			sectionId: "experience",
			itemId: "kettle",
			field: "position",
		});
	});
});

describe("resolvePatchProposal", () => {
	it("returns a pending patch proposal with preconditions, target and rows", () => {
		const result = resolvePatchProposal(
			sample(),
			{
				why: "Posting title.",
				operations: [{ op: "replace", path: "/experience/items/0/position", value: "Product Designer" }],
			},
			labels,
			"c1",
		);
		if (!("proposal" in result)) throw new Error(result.reason);
		expect(result.proposal).toMatchObject({
			id: "c1",
			kind: "patch",
			status: "pending",
			source: "assistant",
			why: "Posting title.",
			target: { sectionId: "experience", itemId: "kettle", field: "position" },
			location: "Experience · Studio Kettle · Position",
			before: "Junior Designer",
			after: "Product Designer",
		});
		expect(result.proposal.operations?.[0]).toEqual({
			op: "test",
			path: "/sections/experience/items/0/position",
			value: "Junior Designer",
		});
	});

	it("skips a forbidden path, an incomplete entry, an unresolvable path and a no-op, each with a reason", () => {
		const d = sample();
		const reason = (ops: Parameters<typeof resolvePatchProposal>[1]["operations"]) => {
			const r = resolvePatchProposal(d, { why: "x", operations: ops }, labels, "c");
			return "reason" in r ? r.reason : "";
		};
		expect(reason([{ op: "replace", path: "/metadata/template", value: "x" }])).toMatch(/design/i);
		expect(reason([{ op: "add", path: "/sections/skills/items/-", value: { name: "Go" } }])).toMatch(/id|invalid/i);
		expect(reason([{ op: "replace", path: "/sections/experience/items/7/position", value: "x" }])).toMatch(
			/does not exist|unresolvable/i,
		);
		expect(reason([{ op: "replace", path: "/basics/headline", value: "Junior Designer" }])).toMatch(/doesn't change/i);
	});
});

describe("applyPatchTo", () => {
	it("applies operations to a copy, honouring tests, and leaves the original alone", () => {
		const header = { name: "Letter", recipientName: "Ms Doe" };
		const next = applyPatchTo(header, [
			{ op: "test", path: "/recipientName", value: "Ms Doe" },
			{ op: "replace", path: "/recipientName", value: "Ms Dow" },
		]);
		expect(next).toEqual({ name: "Letter", recipientName: "Ms Dow" });
		expect(header.recipientName).toBe("Ms Doe");
		expect(() => applyPatchTo(header, [{ op: "test", path: "/recipientName", value: "Nope" }])).toThrow();
	});
});

describe("appends", () => {
	it("carry no precondition (JSON Patch can't test a missing index); indexed adds at or past the end are appends too", () => {
		const d = sample();
		const dash = withPreconditions(d, [
			{ op: "add", path: "/sections/skills/items/-", value: { id: "s9", name: "Go" } },
		]);
		expect(dash.filter((op) => op.op === "test")).toEqual([]);
		const indexed = withPreconditions(d, [
			{ op: "add", path: "/sections/skills/items/2", value: { id: "s9", name: "Go" } },
		]);
		expect(indexed.filter((op) => op.op === "test")).toEqual([]);
		const insert = withPreconditions(d, [
			{ op: "add", path: "/sections/skills/items/0", value: { id: "s9", name: "Go" } },
		]);
		expect(insert[0]).toEqual({ op: "test", path: "/sections/skills/items/0", value: d.sections.skills.items[0] });
	});

	it("describe a keyword or custom-field append with the added value, without a trailing index in the label", () => {
		const before = sample();
		const after = structuredClone(before);
		const figma = after.sections.skills.items[0];
		if (!figma) throw new Error("fixture");
		figma.keywords = ["Design systems"];
		const rows = describeChanges(
			before,
			after,
			[{ op: "add", path: "/sections/skills/items/0/keywords/-", value: "Design systems" }],
			labels,
		);
		expect(rows).toEqual([
			{
				path: "/sections/skills/items/0/keywords/-",
				label: "Skills · Figma · Keywords",
				before: "",
				after: "Add “Design systems”",
			},
		]);
	});
});

describe("custom sections", () => {
	it("labels a change in a custom section with the section's title, not its index", () => {
		const before = sample();
		before.customSections = [
			{
				id: "tools",
				type: "skills",
				title: "Tools",
				icon: "",
				columns: 1,
				hidden: false,
				showHeading: true,
				keepTogether: false,
				startOnNewPage: false,
				items: [
					{ id: "t1", hidden: false, name: "Hammer", proficiency: "", level: 0, keywords: [], icon: "", iconColor: "" },
				],
			} as never,
		];
		const after = structuredClone(before);
		const hammer = (after.customSections[0] as { items: Array<{ name: string }> }).items[0];
		if (!hammer) throw new Error("fixture");
		hammer.name = "Mallet";
		const rows = describeChanges(
			before,
			after,
			[{ op: "replace", path: "/customSections/0/items/0/name", value: "Mallet" }],
			{
				...labels,
				sectionTitle: (id) => (id === "tools" ? "Tools" : id),
			},
		);
		expect(rows[0]?.label).toBe("Tools · Hammer · Name");
	});
});

describe("minor fixes from the R7 review", () => {
	it("refuses to copy an entry, and refuses to write an entry's or a role's id", () => {
		const d = sample();
		const reason = (ops: Parameters<typeof resolvePatchProposal>[1]["operations"]) => {
			const r = resolvePatchProposal(d, { why: "x", operations: ops }, labels, "c");
			return "reason" in r ? r.reason : "";
		};
		expect(reason([{ op: "copy", from: "/sections/skills/items/0", path: "/sections/skills/items/-" }])).toMatch(
			/copy|own id/i,
		);
		expect(contentPathProblem("/sections/skills/items/0/id")).toMatch(/id/);
		expect(contentPathProblem("/sections/experience/items/0/roles/0/id")).toMatch(/id/);
		expect(contentPathProblem("/basics/customFields/0/id")).toBeNull();
	});

	it("names an unknown field instead of calling the change a no-op, and still allows adding dates to a legacy entry", () => {
		const d = sample();
		const r = resolvePatchProposal(
			d,
			{ why: "x", operations: [{ op: "add", path: "/sections/experience/items/0/positon", value: "X" }] },
			labels,
			"c",
		);
		expect("reason" in r ? r.reason : "").toMatch(/unknown field "positon"/);
		const entry = d.sections.experience.items[0];
		if (!entry) throw new Error("fixture");
		delete (entry as { dates?: unknown }).dates;
		const ok = resolvePatchProposal(
			d,
			{
				why: "x",
				operations: [
					{
						op: "add",
						path: "/sections/experience/items/0/dates",
						value: { start: "2016-01", end: null, present: true },
					},
				],
			},
			labels,
			"c",
		);
		expect("proposal" in ok).toBe(true);
	});
});

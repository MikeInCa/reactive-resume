import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { collectPassages, readTarget } from "@reactive-resume/resume/proposals";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const dbMock = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("../resume/service", () => ({ resumeService: {} }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: {} }));

const { documentView, findPosting, resolveChanges, resolveEdits } = await import("./document");

function makeDocument() {
	const data = structuredClone(defaultResumeData);
	data.summary.content = "";
	data.sections.experience.items = [
		{
			id: "lumen",
			hidden: false,
			company: "Lumen Health",
			position: "Designer",
			location: "",
			period: "",
			website: { url: "", label: "", inlineLink: false },
			description: "<ul><li><p>Built the design system</p></li><li><p>Ran usability sessions</p></li></ul>",
			roles: [],
		} as never,
	];
	const passages = collectPassages(data, {
		includeEmpty: true,
		summary: "Summary",
		sectionTitle: () => "Experience",
		entryTitle: () => "Lumen Health",
		bullet: (n) => `bullet ${n}`,
		paragraph: (n) => `paragraph ${n}`,
	});
	return {
		data,
		passages,
		document: {
			kind: "resume" as const,
			name: "Resume",
			updatedAt: new Date(),
			locked: false,
			applicationId: null,
			passages,
			data,
			read: (target: Parameters<typeof readTarget>[1]) => readTarget(data, target),
			view: {},
		},
	};
}

describe("agent documents", () => {
	it("reads the explicitly chosen application through an owner-scoped query", async () => {
		const where = vi.fn((_predicate: SQL) => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }));
		dbMock.select.mockReturnValue({ from: () => ({ where }) });
		await findPosting("alice", "base", { kind: "resume", applicationId: "other-job" }, "clicked-job");
		const predicate = where.mock.calls[0]?.[0];
		if (!predicate) throw new Error("Expected application query");
		const query = new PgDialect().sqlToQuery(predicate);
		expect(query.sql).toContain('"application"."user_id"');
		expect(query.sql).toContain('"application"."id"');
		expect(query.params).toEqual(["alice", "clicked-job"]);
	});

	it("places rewrites, additions and an empty summary, and skips edits on text that changed", () => {
		const { document, passages } = makeDocument();
		const [summary, first, second] = passages;
		if (!summary || !first || !second) throw new Error("Expected three passages");
		expect(summary.html).toBe("");

		const output = resolveEdits(document, {
			title: "Tailor",
			edits: [
				{
					passageId: first.id,
					text: "Built the Lumen design system and rolled it out",
					why: "Leads with the rollout.",
				},
				{ passageId: second.id, text: "Introduced monthly accessibility reviews", why: "You said so.", add: true },
				{ passageId: summary.id, text: "Product designer for health tools.", why: "A summary." },
				{ passageId: "p_gone", text: "Anything", why: "Stale." },
				{ passageId: first.id, text: "Built the design system", why: "No change." },
			],
		});

		expect(output.title).toBe("Tailor");
		expect(output.edits.map(({ before, after, status }) => ({ before, after, status }))).toEqual([
			{
				before: "<p>Built the design system</p>",
				after: "<p>Built the Lumen design system and rolled it out</p>",
				status: "pending",
			},
			{
				before: "<p>Ran usability sessions</p></li>",
				after: "<p>Ran usability sessions</p></li><li><p>Introduced monthly accessibility reviews</p></li>",
				status: "pending",
			},
			{ before: "", after: "<p>Product designer for health tools.</p>", status: "pending" },
		]);
		expect(output.edits[0]?.location).toBe("Experience · Lumen Health · bullet 1");
		expect(output.skipped.map((skip) => skip.passageId)).toEqual(["p_gone", first.id]);
	});

	it("places a removal with its list item, and skips removing an empty passage", () => {
		const { document, passages } = makeDocument();
		const [summary, first] = passages;
		if (!summary || !first) throw new Error("Expected passages");

		const output = resolveEdits(document, {
			title: "Trim",
			edits: [
				{ passageId: first.id, why: "Repeats the second bullet.", remove: true },
				{ passageId: summary.id, why: "Nothing there.", remove: true },
			],
		});

		expect(output.edits.map(({ before, after, status }) => ({ before, after, status }))).toEqual([
			{ before: "<li><p>Built the design system</p></li>", after: "", status: "pending" },
		]);
		expect(output.skipped.map((skip) => skip.passageId)).toEqual([summary.id]);
	});

	it("exposes a fields view with addresses in the read tool result", () => {
		const { document } = makeDocument();
		const view = documentView(document) as {
			data: { fields: { basics: { path: string }; sections: Array<{ id: string; items: Array<{ path: string }> }> } };
		};
		expect(view.data.fields.basics.path).toBe("/basics");
		expect(view.data.fields.sections.find((s) => s.id === "experience")?.items[0]?.path).toBe(
			"/sections/experience/items/0",
		);
	});

	it("resolves field changes into patch proposals with preconditions and skips the rest with reasons", () => {
		const { document, data } = makeDocument();
		const output = resolveChanges(document, {
			title: "Tailor",
			changes: [
				{
					why: "Posting title.",
					operations: [{ op: "replace", path: "/experience/items/0/position", value: "Lead Designer" }],
				},
				{ why: "Nope.", operations: [{ op: "replace", path: "/metadata/template", value: "x" }] },
				{ why: "Same.", operations: [{ op: "replace", path: "/basics/name", value: data.basics.name }] },
			],
		});
		expect(output.proposals).toHaveLength(1);
		expect(output.proposals[0]).toMatchObject({
			kind: "patch",
			status: "pending",
			location: "Experience · Lumen Health · Position",
			before: "Designer",
			after: "Lead Designer",
			target: { sectionId: "experience", itemId: "lumen", field: "position" },
		});
		expect(output.proposals[0]?.operations[0]).toEqual({
			op: "test",
			path: "/sections/experience/items/0/position",
			value: "Designer",
		});
		expect(output.skipped.map((s) => s.index)).toEqual([1, 2]);
	});

	it("limits a letter to its header fields and describes them", () => {
		const letter = {
			kind: "letter" as const,
			name: "Letter",
			updatedAt: new Date(),
			locked: false,
			applicationId: null,
			passages: [],
			read: () => undefined,
			view: {},
			letter: { name: "Letter", recipient: "", recipientName: "Ms Doe", recipientCompany: "Lumen", letterDate: "" },
		};
		const output = resolveChanges(letter, {
			title: "Fix",
			changes: [
				{ why: "Spelling.", operations: [{ op: "replace", path: "/recipientName", value: "Ms Dow" }] },
				{ why: "Body.", operations: [{ op: "replace", path: "/content", value: "x" }] },
			],
		});
		expect(output.proposals[0]).toMatchObject({
			kind: "patch",
			location: "Letter · Recipient name",
			before: "Ms Doe",
			after: "Ms Dow",
			target: { sectionId: "letter", field: "recipientName" },
		});
		expect(output.skipped[0]?.reason).toMatch(/propose_edits|header/);
	});

	it("refuses a non-text value for a letter header field, with a reason", () => {
		const letter = {
			kind: "letter" as const,
			name: "Letter",
			updatedAt: new Date(),
			locked: false,
			applicationId: null,
			passages: [],
			read: () => undefined,
			view: {},
			letter: { name: "Letter", recipient: "", recipientName: "Ms Doe", recipientCompany: "Lumen", letterDate: "" },
		};
		const output = resolveChanges(letter, {
			title: "Bad",
			changes: [
				{ why: "Null.", operations: [{ op: "replace", path: "/recipientName", value: null }] },
				{ why: "Object.", operations: [{ op: "replace", path: "/recipientCompany", value: { a: 1 } }] },
			],
		});
		expect(output.proposals).toEqual([]);
		expect(output.skipped.map((skip) => skip.reason)).toEqual([
			expect.stringMatching(/text/),
			expect.stringMatching(/text/),
		]);
	});
});

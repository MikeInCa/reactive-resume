import type { Proposal } from "@reactive-resume/resume/proposals";
import { describe, expect, it } from "vitest";
import { applyLetterProposals } from "./letter-proposals";

const header = { name: "Letter", recipient: "", recipientName: "Ms Doe", recipientCompany: "Lumen", letterDate: null };

const patch = (id: string, field: string, from: string, to: string): Proposal => ({
	id,
	kind: "patch",
	target: { sectionId: "letter", field },
	location: `Letter · ${field}`,
	before: from,
	after: to,
	why: "w",
	status: "pending",
	source: "assistant",
	operations: [
		{ op: "test", path: `/${field}`, value: from },
		{ op: "replace", path: `/${field}`, value: to },
	],
	changes: [],
});

describe("applyLetterProposals", () => {
	it("returns only the header fields that changed, keeps a null date null, and applies passage edits to the body", () => {
		const passage: Proposal = {
			id: "p",
			target: { sectionId: "letter", field: "content" },
			location: "Letter · paragraph 1",
			before: "<p>Hi</p>",
			after: "<p>Hello</p>",
			why: "w",
			status: "pending",
			source: "assistant",
		};
		const result = applyLetterProposals(header, "<p>Hi</p>", [
			patch("r", "recipientName", "Ms Doe", "Ms Dow"),
			passage,
		]);
		expect(result.applied.map((p) => p.id)).toEqual(["r", "p"]);
		expect(result.header).toEqual({ recipientName: "Ms Dow" });
		expect(result.content).toBe("<p>Hello</p>");
		expect("letterDate" in result.header).toBe(false);
	});

	it("leaves a stale header change out", () => {
		const result = applyLetterProposals(header, "", [patch("r", "recipientName", "Someone Else", "Ms Dow")]);
		expect(result.applied).toEqual([]);
		expect(result.header).toEqual({});
	});
});

import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { collectPassages } from "@reactive-resume/resume/proposals";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { mapWritingReview } from "./review";

function makeData(): ResumeData {
	const data = structuredClone(defaultResumeData);
	data.sections.experience.items = [
		{
			id: "kettle",
			hidden: false,
			company: "Studio Kettle",
			position: "Designer",
			location: "",
			period: "",
			website: { url: "", label: "", inlineLink: false },
			description: "<ul><li><p>Responsible for various design tasks</p></li><li><p>Shipped 20 identities</p></li></ul>",
			roles: [],
		} as ResumeData["sections"]["experience"]["items"][number],
	];
	return data;
}

const labels = {
	summary: "Summary",
	sectionTitle: () => "Experience",
	entryTitle: () => "Studio Kettle",
	bullet: (n: number) => `bullet ${n}`,
	paragraph: (n: number) => `paragraph ${n}`,
};

describe("mapWritingReview", () => {
	it("turns a removal of a sent passage into a removal proposal that takes its list item", () => {
		const data = makeData();
		const passages = collectPassages(data, labels);
		const [first] = passages;
		if (!first) throw new Error("Expected a passage");

		const { proposals, notes } = mapWritingReview(
			[
				{
					section: "Experience",
					passageId: first.id,
					issue: "Duty, no outcome.",
					rewrite: null,
					impact: "high",
					remove: true,
				},
			],
			passages,
			data,
		);

		expect(notes).toEqual([]);
		expect(proposals).toHaveLength(1);
		expect(proposals[0]).toMatchObject({
			before: "<li><p>Responsible for various design tasks</p></li>",
			after: "",
			why: "Duty, no outcome.",
			source: "check",
			location: "Experience · Studio Kettle · bullet 1",
		});
	});

	it("keeps a removal of an unknown passage, and a plain rewrite, as before", () => {
		const data = makeData();
		const passages = collectPassages(data, labels);
		const [, second] = passages;
		if (!second) throw new Error("Expected two passages");

		const { proposals, notes } = mapWritingReview(
			[
				{ section: "Skills", passageId: "p_gone", issue: "Cut this.", rewrite: null, impact: "low", remove: true },
				{
					section: null,
					passageId: second.id,
					issue: "Add the client type.",
					rewrite: "Shipped 20 retail identities",
					impact: "medium",
					remove: false,
				},
			],
			passages,
			data,
		);

		expect(notes.map((note) => note.note)).toEqual(["Cut this."]);
		expect(proposals.map((proposal) => proposal.after)).toEqual(["<p>Shipped 20 retail identities</p>"]);
	});
});

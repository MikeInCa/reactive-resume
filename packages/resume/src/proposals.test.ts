import { describe, expect, it } from "vitest";
import { experienceItemSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	additionAfter,
	applyProposal,
	applyTo,
	collectLetterPassages,
	collectPassages,
	getPatchProposalState,
	getProposalState,
	getStateIn,
	locatePassage,
	patchTestsPass,
	readTarget,
	removalOf,
} from "./proposals";

const labels = { body: "Letter", bullet: (n: number) => `bullet ${n}`, paragraph: (n: number) => `paragraph ${n}` };

it("rejects ambiguous paragraphs instead of replacing the first occurrence", () => {
	const value = "<p>Repeated claim.</p><p>Different middle.</p><p>Repeated claim.</p>";
	expect(applyTo(value, { before: "<p>Repeated claim.</p>", after: "<p>Changed</p>" })).toBeUndefined();
	expect(additionAfter(value, "<p>Repeated claim.</p>", "Added")).toBeUndefined();
	expect(applyTo("<p>Unique</p>", { before: "<p>Unique</p>", after: "<p>$&</p>" })).toBe("<p>$&</p>");
});

it("collects and edits nested role descriptions and custom summaries without changing siblings", () => {
	const data = structuredClone(defaultResumeData);
	data.sections.experience.items = [
		experienceItemSchema.parse({
			id: "company",
			hidden: false,
			company: "Kettle",
			position: "",
			location: "",
			period: "",
			description: "",
			website: { url: "", label: "" },
			roles: [
				{ id: "lead", position: "Lead", period: "", description: "<p>Led delivery.</p>" },
				{ id: "engineer", position: "Engineer", period: "", description: "<p>Built services.</p>" },
			],
		}),
	];
	data.customSections = [
		{
			id: "custom",
			type: "summary",
			title: "About",
			icon: "",
			columns: 1,
			hidden: false,
			keepTogether: false,
			startOnNewPage: false,
			items: [{ id: "about", hidden: false, content: "<p>Custom prose.</p>" }],
		},
	];
	const passages = collectPassages(data, {
		...labels,
		summary: "Summary",
		sectionTitle: (id) => id,
		entryTitle: () => "Kettle",
	});
	expect(passages.map((passage) => passage.text)).toEqual(["Led delivery.", "Built services.", "Custom prose."]);
	for (const passage of [passages[0], passages[2]]) {
		if (!passage) throw new Error("Missing supported passage");
		expect(
			applyProposal(data, {
				id: passage.id,
				target: passage.target,
				location: passage.location,
				before: passage.html,
				after: "<p>Revised.</p>",
				why: "Clearer",
				status: "pending",
				source: "check",
			}),
		).toBe(true);
		expect(readTarget(data, passage.target)).toBe("<p>Revised.</p>");
	}
	expect(data.sections.experience.items[0]?.roles[1]?.description).toBe("<p>Built services.</p>");
	expect(data.sections.experience.items[0]?.description).toBe("");
	const experience = data.sections.experience.items[0];
	const custom = data.customSections[0];
	if (!experience || !custom) throw new Error("Missing fixtures");
	experience.hidden = true;
	custom.hidden = true;
	expect(
		collectPassages(data, { ...labels, summary: "Summary", sectionTitle: (id) => id, entryTitle: () => "Kettle" }),
	).toEqual([]);
});

describe("additionAfter", () => {
	it("adds a paragraph after a paragraph, and nothing for a passage that's gone", () => {
		expect(additionAfter("<p>One</p><p>Two</p>", "<p>One</p>", "Between")).toEqual({
			before: "<p>One</p>",
			after: "<p>One</p><p>Between</p>",
		});
		expect(additionAfter("<p>One</p>", "<p>Gone</p>", "x")).toBeUndefined();
	});
});

describe("collectLetterPassages", () => {
	it("lists the body's paragraphs with stable ids that change with the text", () => {
		const passages = collectLetterPassages("<p>Hello there.</p><p>Hello there.</p><p>Bye.</p>", labels);

		expect(passages.map((passage) => passage.location)).toEqual([
			"Letter · paragraph 1",
			"Letter · paragraph 2",
			"Letter · paragraph 3",
		]);
		expect(passages[1]?.id).toBe(`${passages[0]?.id}_2`);
		expect(collectLetterPassages("<p>Hello, there.</p>", labels)[0]?.id).not.toBe(passages[0]?.id);
	});

	it("offers an empty body as one empty passage only when asked", () => {
		expect(collectLetterPassages("", labels)).toEqual([]);
		const [empty] = collectLetterPassages("", { ...labels, includeEmpty: true });
		expect(empty).toMatchObject({ html: "", text: "", location: "Letter" });
		// Writing into it replaces the empty text.
		expect(applyTo("", { before: "", after: "<p>Dear team</p>" })).toBe("<p>Dear team</p>");
	});
});

describe("removalOf", () => {
	it("removes a paragraph, leaving its neighbours", () => {
		const value = "<p>One</p><p>Two</p><p>Three</p>";
		const removal = removalOf(value, "<p>Two</p>");
		expect(removal).toEqual({ before: "<p>Two</p>", after: "" });
		expect(applyTo(value, removal ?? { before: "", after: "" })).toBe("<p>One</p><p>Three</p>");
	});

	it("removes a bullet with its list item, so no empty item is left", () => {
		const value = "<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>";
		const removal = removalOf(value, "<p>B</p>");
		expect(removal).toEqual({ before: "<li><p>B</p></li>", after: "" });
		expect(applyTo(value, removal ?? { before: "", after: "" })).toBe("<ul><li><p>A</p></li><li><p>C</p></li></ul>");
	});

	it("removes the last bullet with its list, so no empty list is left", () => {
		const value = "<p>Intro</p><ul><li><p>Only</p></li></ul>";
		const removal = removalOf(value, "<p>Only</p>");
		expect(removal).toEqual({ before: "<ul><li><p>Only</p></li></ul>", after: "" });
		expect(applyTo(value, removal ?? { before: "", after: "" })).toBe("<p>Intro</p>");
	});

	it("refuses a passage that is gone, repeated or empty", () => {
		expect(removalOf("<p>One</p>", "<p>Gone</p>")).toBeUndefined();
		expect(removalOf("<p>Same</p><p>Same</p>", "<p>Same</p>")).toBeUndefined();
		expect(removalOf("", "")).toBeUndefined();
	});
});

describe("getStateIn", () => {
	it("shows an accepted removal as pending again once the passage is back", () => {
		const removal = {
			id: "r",
			target: { sectionId: "summary", field: "content" },
			location: "Summary",
			before: "<p>Two</p>",
			after: "",
			why: "Redundant",
			status: "accepted" as const,
			source: "assistant" as const,
		};
		expect(getStateIn("<p>One</p>", removal)).toBe("accepted");
		expect(getStateIn("<p>One</p><p>Two</p>", removal)).toBe("pending");
	});
});

describe("locatePassage", () => {
	it("finds where a rewrite, an addition and a removal land, and nothing for a repeated passage", () => {
		const passages = collectLetterPassages("<ul><li><p>One</p></li><li><p>Two</p></li></ul><p>Two</p>", labels);
		const target = { sectionId: "letter", field: "content" };
		expect(locatePassage(passages, { before: "<p>One</p>", target })).toBe("Letter · bullet 1");
		expect(locatePassage(passages, { before: "<p>One</p></li>", target })).toBe("Letter · bullet 1");
		expect(locatePassage(passages, { before: "<li><p>One</p></li>", target })).toBe("Letter · bullet 1");
		expect(locatePassage(passages, { before: "<p>Two</p>", target })).toBeUndefined();
		expect(locatePassage(passages, { before: "<p>One</p>", target: { ...target, field: "other" } })).toBeUndefined();
	});
});

describe("patch proposals", () => {
	const data = () => {
		const d = structuredClone(defaultResumeData);
		d.basics.headline = "Junior Designer";
		return d;
	};
	const patch = (status: "pending" | "accepted" | "rejected" = "pending") => ({
		id: "c1",
		kind: "patch" as const,
		target: { sectionId: "basics", field: "headline" },
		location: "Basics · Headline",
		before: "Junior Designer",
		after: "Product Designer",
		why: "Matches the posting.",
		status,
		source: "assistant" as const,
		operations: [
			{ op: "test" as const, path: "/basics/headline", value: "Junior Designer" },
			{ op: "replace" as const, path: "/basics/headline", value: "Product Designer" },
		],
		changes: [
			{ path: "/basics/headline", label: "Basics · Headline", before: "Junior Designer", after: "Product Designer" },
		],
	});

	it("is pending while its tests pass and out of date once they fail", () => {
		const d = data();
		expect(patchTestsPass(d, patch().operations)).toBe(true);
		expect(getProposalState(d, patch())).toBe("pending");
		expect(getPatchProposalState(d, patch())).toBe("pending");
		d.basics.headline = "Someone edited this";
		expect(getProposalState(d, patch())).toBe("stale");
		expect(getProposalState(d, patch("rejected"))).toBe("rejected");
	});

	it("applies through JSON Patch, then reads as accepted, and as pending again after an undo", () => {
		const d = data();
		expect(applyProposal(d, patch())).toBe(true);
		expect(d.basics.headline).toBe("Product Designer");
		expect(getProposalState(d, patch("accepted"))).toBe("accepted");
		expect(applyProposal(d, patch())).toBe(false); // the test op fails now
		d.basics.headline = "Junior Designer"; // undo
		expect(getProposalState(d, patch("accepted"))).toBe("pending");
	});

	it("leaves passage proposals exactly as before", () => {
		const passage = {
			...patch(),
			kind: "passage" as const,
			target: { sectionId: "summary", field: "content" },
			before: "<p>One</p>",
			after: "<p>Two</p>",
		};
		expect(getStateIn("<p>One</p>", passage)).toBe("pending");
	});
});

describe("accepted appends", () => {
	it("read as accepted while the added entry is in the list, and pending again once it is gone", () => {
		const d = structuredClone(defaultResumeData);
		const append = {
			id: "a1",
			kind: "patch" as const,
			target: { sectionId: "skills", field: "items" },
			location: "Skills",
			before: "",
			after: "Add entry “Go”",
			why: "Asked for.",
			status: "accepted" as const,
			source: "assistant" as const,
			operations: [
				{
					op: "add" as const,
					path: "/sections/skills/items/-",
					value: {
						id: "s9",
						hidden: false,
						name: "Go",
						proficiency: "",
						level: 0,
						keywords: [],
						icon: "",
						iconColor: "",
					},
				},
			],
			changes: [{ path: "/sections/skills/items/-", label: "Skills", before: "", after: "Add entry “Go”" }],
		};
		expect(applyProposal(d, { ...append, status: "pending" })).toBe(true);
		expect(getProposalState(d, append)).toBe("accepted");
		d.sections.skills.items = d.sections.skills.items.filter((item) => item.id !== "s9"); // undo
		expect(getProposalState(d, append)).toBe("pending");
	});
});

describe("minor fixes from the R7 review", () => {
	it("judges a test op by value, not by key order, and never mutates the document", () => {
		const d = structuredClone(defaultResumeData);
		const website = { label: d.basics.website.label, url: d.basics.website.url }; // keys reversed
		const frozen = JSON.stringify(d);
		expect(patchTestsPass(d, [{ op: "test", path: "/basics/website", value: website }])).toBe(true);
		expect(patchTestsPass(d, [{ op: "test", path: "/basics/website", value: { ...website, url: "x" } }])).toBe(false);
		expect(patchTestsPass(d, [{ op: "test", path: "/nope/nope", value: 1 }])).toBe(false);
		expect(JSON.stringify(d)).toBe(frozen);
	});

	it("inserts a copy of an added value, so the proposal's operations stay independent of the draft", () => {
		const d = structuredClone(defaultResumeData);
		const value = {
			id: "s9",
			hidden: false,
			name: "Go",
			proficiency: "",
			level: 0,
			keywords: [],
			icon: "",
			iconColor: "",
		};
		const add = {
			id: "a1",
			kind: "patch" as const,
			target: { sectionId: "skills", field: "items" },
			location: "Skills",
			before: "",
			after: "Add entry “Go”",
			why: "w",
			status: "pending" as const,
			source: "assistant" as const,
			operations: [{ op: "add" as const, path: "/sections/skills/items/-", value }],
			changes: [],
		};
		expect(applyProposal(d, add)).toBe(true);
		const inserted = d.sections.skills.items.find((item) => item.id === "s9");
		expect(inserted).toEqual(value);
		expect(inserted).not.toBe(value);
	});
});

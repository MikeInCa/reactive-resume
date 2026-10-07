import { describe, expect, it } from "vitest";
import { atsReviewOutputSchema } from "./ats-review";

describe("atsReviewOutputSchema", () => {
	it("keeps the good entries when one is malformed", () => {
		const parsed = atsReviewOutputSchema.parse({
			summary: "Reads clearly.",
			suggestions: [
				{ section: null, issue: "Vague bullet.", rewrite: null, impact: "shouty" },
				{ section: null, issue: "", rewrite: null, impact: "low" },
			],
			strengths: ["Good", ""],
			jdAlignment: { verdict: "Close fit.", missingConcepts: ["kubernetes"], strengths: [] },
		});

		expect(parsed.suggestions).toHaveLength(1);
		expect(parsed.suggestions[0]?.impact).toBe("medium");
		expect(parsed.strengths).toEqual(["Good"]);
		expect(parsed.jdAlignment?.missingConcepts).toEqual(["kubernetes"]);
	});

	it("reads a removal flag and defaults it to false", () => {
		const parsed = atsReviewOutputSchema.parse({
			summary: "",
			suggestions: [
				{
					section: "Experience",
					passageId: "p_1",
					issue: "Repeats bullet 2.",
					rewrite: null,
					impact: "high",
					remove: true,
				},
				{ section: null, passageId: "p_2", issue: "Vague.", rewrite: "Clearer.", impact: "low" },
				{ section: null, passageId: "p_3", issue: "Odd flag.", rewrite: null, impact: "low", remove: "yes" },
			],
			strengths: [],
			jdAlignment: null,
		});

		expect(parsed.suggestions.map((entry) => entry.remove)).toEqual([true, false, false]);
	});
});

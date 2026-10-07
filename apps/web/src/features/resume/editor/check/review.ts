import type { WritingNote } from "../store";
import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { Passage, Proposal } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { readTarget, removalOf, replaceBlockText } from "@reactive-resume/resume/proposals";

type ReviewSuggestion = {
	section: string | null;
	passageId: string | null;
	issue: string;
	rewrite: string | null;
	impact: WritingNote["impact"];
	/** Cut the passage instead of rewriting it. */
	remove?: boolean;
};

const toPageTarget = (target: Proposal["target"]): PageMapTarget =>
	target.itemId
		? { kind: "item", sectionId: target.sectionId, itemId: target.itemId }
		: { kind: "section", sectionId: target.sectionId };

/**
 * Sorts a writing review's suggestions: a rewrite or removal of a passage that was sent becomes a proposal to accept
 * or reject; anything else (advice, or a rewrite of text it wasn't given) stays a note. `data` is the resume the
 * passages came from, so a removal can take a bullet's list item with it.
 */
export function mapWritingReview(
	suggestions: readonly ReviewSuggestion[],
	passages: readonly Passage[],
	data: ResumeData,
) {
	const byId = new Map(passages.map((passage) => [passage.id, passage]));
	const proposals: Proposal[] = [];
	const notes: WritingNote[] = [];

	for (const suggestion of suggestions) {
		const passage = suggestion.passageId ? byId.get(suggestion.passageId) : undefined;
		const rewrite = suggestion.rewrite?.trim();
		const placed = suggestion.remove
			? passage && removalOf(readTarget(data, passage.target) ?? "", passage.html)
			: passage && rewrite && rewrite !== passage.text
				? { before: passage.html, after: replaceBlockText(passage.html, rewrite) }
				: undefined;

		if (passage && placed) {
			proposals.push({
				id: `w${proposals.length + 1}`,
				target: passage.target,
				location: passage.location,
				before: placed.before,
				after: placed.after,
				why: suggestion.issue,
				status: "pending",
				source: "check",
			});
			continue;
		}

		notes.push({
			location: passage?.location ?? suggestion.section ?? "",
			impact: suggestion.impact,
			quote: passage?.text ?? "",
			note: suggestion.issue,
			target: passage ? toPageTarget(passage.target) : null,
		});
	}

	return { proposals, notes };
}

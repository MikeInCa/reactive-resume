import type { Proposal } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { t } from "@lingui/core/macro";
import { produce } from "immer";
import {
	applyProposal,
	applyTo,
	getProposalState,
	isPatchProposal,
	readTarget,
	splitBlock,
	splitBlocks,
	writeTarget,
} from "@reactive-resume/resume/proposals";
import { toast } from "@reactive-resume/ui/components/toast";
import { useResumeStore } from "@/features/resume/builder/draft";

// Colours of the page marks (README §5.9), as the PDF needs them: old text struck through in grey, new text on
// a pale accent highlight.
const OLD_TEXT_COLOR = "#7d7b73";
const NEW_TEXT_BACKGROUND = "#d4efd9";

const struck = (html: string) => `<s style="color: ${OLD_TEXT_COLOR}">${html}</s>`;
const highlighted = (html: string) => `<mark data-color="${NEW_TEXT_BACKGROUND}">${html}</mark>`;

/** The old text struck through, then the new text highlighted, inside the passage's own block. */
export function markChange(before: string, after: string) {
	// An addition keeps the passage and adds a block after it: only the new block is marked.
	if (after.startsWith(before) && after.length > before.length) {
		const added = after.slice(before.length);
		const marked = splitBlocks(added).reduce((html, block) => {
			const parts = splitBlock(block.html);
			return parts ? html.replace(block.html, () => `${parts.open}${highlighted(parts.inner)}${parts.close}`) : html;
		}, added);
		return `${before}${marked === added ? highlighted(added) : marked}`;
	}

	// A removal: the passage's blocks struck through, nothing added.
	if (after === "")
		return splitBlocks(before).reduce((html, block) => {
			const parts = splitBlock(block.html);
			return parts ? html.replace(block.html, () => `${parts.open}${struck(parts.inner)}${parts.close}`) : html;
		}, before);

	const old = splitBlock(before);
	const next = splitBlock(after);
	if (!old || !next) return `${struck(before)} ${highlighted(after)}`;
	return `${old.open}${struck(old.inner)} ${highlighted(next.inner)}${old.close}`;
}

/** The proposals still waiting on the user (not accepted, rejected or out of date), optionally in one section. */
export const pendingProposals = (data: ResumeData, proposals: readonly Proposal[], sectionId?: string) =>
	proposals.filter(
		(proposal) =>
			(sectionId === undefined || proposal.target.sectionId === sectionId) &&
			getProposalState(data, proposal) === "pending",
	);

/**
 * The page as it would read with the proposals: each passage struck through, followed by its replacement,
 * highlighted. For the preview only; it's never saved.
 */
export function markProposals(data: ResumeData, proposals: readonly Proposal[]): ResumeData {
	// Field changes (patch proposals) are reviewed on their cards; only passages are drawn on the page.
	const pending = pendingProposals(data, proposals).filter((proposal) => !isPatchProposal(proposal));
	if (pending.length === 0) return data;

	return produce(data, (draft) => {
		for (const proposal of pending) {
			const value = readTarget(draft, proposal.target);
			const marked = markChange(proposal.before, proposal.after);
			const next = applyTo(value, { before: proposal.before, after: marked });
			if (next !== undefined) writeTarget(draft, proposal.target, next);
		}
	});
}

/**
 * Applies proposals to a draft in order and returns the ones that applied. A later proposal's preconditions can be
 * invalidated by an earlier one in the same batch (a move shifts the index a rename tests); that one applies nothing
 * and is left out, so it keeps reading as pending or out of date instead of "Applied".
 */
export function applyProposalsToDraft(draft: WritableDraft<ResumeData>, proposals: readonly Proposal[]): Proposal[] {
	return proposals.filter((proposal) => applyProposal(draft, proposal));
}

/**
 * Applies proposals to the resume as one undo step and returns the ones that applied; the toast's Undo takes them
 * back, and they show as pending again.
 */
export function acceptResumeProposals(proposals: readonly Proposal[]): Proposal[] {
	let applied: Proposal[] = [];
	useResumeStore.getState().updateResumeData(
		(draft) => {
			applied = applyProposalsToDraft(draft, proposals);
		},
		{ newStep: true },
	);
	if (applied.length > 0)
		toast.add({
			description: applied.length === 1 ? t`Edit applied` : t`${applied.length} edits applied`,
			actionProps: { children: t`Undo`, onClick: () => useResumeStore.getState().undo() },
		});
	else toast.add({ description: t`Nothing could be applied: the text changed since.` });
	return applied;
}

import type { Proposal } from "@reactive-resume/resume/proposals";
import { applyPatchTo } from "@reactive-resume/resume/patch-proposals";
import { applyTo, isPatchProposal, patchTestsPass } from "@reactive-resume/resume/proposals";

/** The letter fields a patch proposal may change, as the server addresses them (/recipientName, …). */
export type LetterHeader = {
	name: string;
	recipient: string;
	recipientName: string;
	recipientCompany: string;
	letterDate: string | null;
};

export const letterHeaderOf = (letter: LetterHeader & Record<string, unknown>): LetterHeader => ({
	name: letter.name,
	recipient: letter.recipient,
	recipientName: letter.recipientName,
	recipientCompany: letter.recipientCompany,
	letterDate: letter.letterDate,
});

/**
 * Applies proposals to a letter in order: passage edits to the body, header changes to the header while their
 * preconditions hold. Returns the new body, only the header fields that changed, and what applied.
 */
export function applyLetterProposals(
	header: LetterHeader,
	content: string,
	proposals: readonly Proposal[],
): { content: string; header: Partial<LetterHeader>; applied: Proposal[] } {
	const applied: Proposal[] = [];
	let body = content;
	let patched = header;
	for (const proposal of proposals) {
		if (isPatchProposal(proposal)) {
			if (!patchTestsPass(patched, proposal.operations ?? [])) continue;
			patched = applyPatchTo(patched, proposal.operations ?? []);
		} else {
			const next = applyTo(body, proposal);
			if (next === undefined) continue;
			body = next;
		}
		applied.push(proposal);
	}
	const changed: Partial<LetterHeader> = {};
	for (const key of Object.keys(header) as Array<keyof LetterHeader>) {
		if (patched[key] !== header[key]) (changed as Record<string, unknown>)[key] = patched[key];
	}
	return { content: body, header: changed, applied };
}

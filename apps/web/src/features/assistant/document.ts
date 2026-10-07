import type { Proposal, ProposalState } from "@reactive-resume/resume/proposals";
import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	collectLetterPassages,
	collectPassages,
	getPatchProposalState,
	getProposalState,
	getStateIn,
	isPatchProposal,
	locatePassage,
} from "@reactive-resume/resume/proposals";
import { toast } from "@reactive-resume/ui/components/toast";
import { applyLetterProposals, letterHeaderOf } from "./letter-proposals";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useLetterEditorStore } from "@/features/letters/store";
import { useCurrentResume } from "@/features/resume/builder/draft";
import { getSectionName } from "@/features/resume/editor/check/issues";
import { acceptResumeProposals } from "@/features/resume/editor/proposals/proposals";
import { describeEntry } from "@/features/resume/editor/write/model";

/** The document the assistant works on, as the panel needs it. Resumes and letters each provide one. */
export type AssistantDocument = {
	kind: "resume" | "letter";
	id: string;
	name: string;
	locked: boolean;
	/** The application it's for, whose posting is shared as context. */
	posting: { id: string; company: string; role: string } | null;
	/** A proposal's state against the document as it reads now. */
	stateOf: (proposal: Proposal) => ProposalState;
	/** Applies proposals as one undo step, with Undo in the toast; returns the ones that applied. */
	accept: (proposals: readonly Proposal[]) => readonly Proposal[];
	/** Where a proposal lands, in the app's language, when its passage is still there. */
	locationOf: (proposal: Pick<Proposal, "before" | "target">) => string | undefined;
};

const bullet = (n: number) => t`bullet ${n}`;
const paragraph = (n: number) => t`paragraph ${n}`;

export function useResumeAssistantDocument(): AssistantDocument {
	const resume = useCurrentResume();
	const { applicationId } = useSearch({ strict: false });
	const { data: applications } = useQuery(applicationsListQueryOptions());
	// The application it was made for, otherwise the latest one it's linked to (as the server reads it).
	const application = applicationId
		? applications?.find((item) => item.id === applicationId)
		: (applications?.find((item) => item.id === resume.applicationId) ??
			applications?.find((item) => item.resumeId === resume.id));

	return useMemo(() => {
		const passages = collectPassages(resume.data, {
			summary: getSectionName(resume.data, "summary"),
			sectionTitle: (sectionId) => getSectionName(resume.data, sectionId),
			entryTitle: (type, entry) => describeEntry(type as never, entry as never).title,
			bullet,
			paragraph,
		});

		return {
			kind: "resume",
			id: resume.id,
			name: resume.name,
			locked: resume.isLocked,
			posting: application ? { id: application.id, company: application.company, role: application.role } : null,
			stateOf: (proposal) => getProposalState(resume.data, proposal),
			accept: acceptResumeProposals,
			locationOf: (proposal) => locatePassage(passages, proposal),
		};
	}, [resume.id, resume.name, resume.isLocked, resume.data, application]);
}

export function useLetterAssistantDocument(): AssistantDocument | null {
	const letter = useLetterEditorStore((state) => state.letter);
	const { applicationId } = useSearch({ strict: false });
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const application = applications?.find((item) => item.id === (applicationId ?? letter?.sourceApplicationId));

	return useMemo(() => {
		if (!letter) return null;
		const passages = collectLetterPassages(letter.content, { body: t`Letter`, bullet, paragraph });

		return {
			kind: "letter",
			id: letter.id,
			name: letter.name,
			locked: letter.isLocked,
			posting: application ? { id: application.id, company: application.company, role: application.role } : null,
			stateOf: (proposal) =>
				isPatchProposal(proposal)
					? getPatchProposalState(letterHeaderOf(letter), proposal)
					: getStateIn(letter.content, proposal),
			accept: (proposals) => {
				const { letter: current, edit } = useLetterEditorStore.getState();
				if (!current) return [];
				const before = current.content;
				const header = letterHeaderOf(current);
				const result = applyLetterProposals(header, before, proposals);
				if (result.applied.length === 0) {
					toast.add({ description: t`Nothing could be applied: the text changed since.` });
					return result.applied;
				}
				// Only what changed is written, and Undo puts back only those fields.
				const touched = Object.keys(result.header) as Array<keyof typeof result.header>;
				const restore = Object.fromEntries(touched.map((key) => [key, header[key]]));
				edit({ ...(result.content === before ? {} : { content: result.content }), ...result.header });
				toast.add({
					description: result.applied.length === 1 ? t`Edit applied` : t`${result.applied.length} edits applied`,
					actionProps: { children: t`Undo`, onClick: () => edit({ content: before, ...restore }) },
				});
				return result.applied;
			},
			locationOf: (proposal) => locatePassage(passages, proposal),
		};
	}, [letter, application]);
}

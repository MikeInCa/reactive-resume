import type {
	ProposeChangesInput,
	ProposeChangesOutput,
	ProposeEditsInput,
	ProposeEditsOutput,
} from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { Passage, ProposalTarget } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { fieldsView } from "@reactive-resume/resume/fields-view";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import {
	applyPatchTo,
	displayValue,
	resolvePatchProposal,
	withPreconditions,
} from "@reactive-resume/resume/patch-proposals";
import {
	additionAfter,
	blockText,
	canApplyTo,
	collectLetterPassages,
	collectPassages,
	readTarget,
	removalOf,
	replaceBlockText,
} from "@reactive-resume/resume/proposals";
import { generateId } from "@reactive-resume/utils/string";
import { coverLetterService } from "../cover-letters/service";
import { resumeService } from "../resume/service";

/** The one document a conversation is about. */
export type AssistantDocument = { kind: "resume" | "letter"; id: string };

export const documentOf = (thread: {
	workingResumeId: string | null;
	coverLetterId: string | null;
}): AssistantDocument | null => {
	if (thread.coverLetterId) return { kind: "letter", id: thread.coverLetterId };
	return thread.workingResumeId ? { kind: "resume", id: thread.workingResumeId } : null;
};

// The model reads passage locations in English; the editor shows its own, translated.
const LABELS = {
	includeEmpty: true,
	summary: "Summary",
	bullet: (n: number) => `bullet ${n}`,
	paragraph: (n: number) => `paragraph ${n}`,
};

const ENTRY_TITLE_FIELDS = ["company", "school", "organization", "name", "title", "network", "language", "position"];

function entryTitle(_type: string, entry: Record<string, unknown>) {
	for (const field of ENTRY_TITLE_FIELDS) {
		const value = entry[field];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

function sectionTitle(data: ResumeData, sectionId: string) {
	const custom = data.customSections.find((section) => section.id === sectionId);
	const title = custom ? custom.title : data.sections[sectionId as keyof ResumeData["sections"]]?.title;
	const fallback = (custom?.type ?? sectionId).replace(/-/g, " ");
	return title?.trim() || fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

/** A letter's header fields: the only letter fields a patch proposal may change. */
export type LetterHeader = {
	name: string;
	recipient: string;
	recipientName: string;
	recipientCompany: string;
	letterDate: string;
};
export const LETTER_FIELD_PATHS = [
	"/name",
	"/recipient",
	"/recipientName",
	"/recipientCompany",
	"/letterDate",
] as const;
const LETTER_LABELS: Record<string, string> = {
	name: "Name",
	recipient: "Recipient block",
	recipientName: "Recipient name",
	recipientCompany: "Recipient company",
	letterDate: "Date",
};

type LoadedDocument = {
	kind: AssistantDocument["kind"];
	/** Resumes: the data the fields view and patch proposals work on. */
	data?: ResumeData;
	/** Letters: the header fields a patch proposal may change. */
	letter?: LetterHeader;
	name: string;
	updatedAt: Date;
	locked: boolean;
	applicationId: string | null;
	passages: Passage[];
	/** The field a proposal targets, as it reads now. */
	read: (target: ProposalTarget) => string | undefined;
	/** What read_resume / read_letter returns to the model. */
	view: Record<string, unknown>;
};

export async function loadDocument(userId: string, document: AssistantDocument): Promise<LoadedDocument> {
	if (document.kind === "resume") {
		const resume = await resumeService.getById({ id: document.id, userId });
		const passages = collectPassages(resume.data, {
			...LABELS,
			sectionTitle: (sectionId) => sectionTitle(resume.data, sectionId),
			entryTitle,
		});

		return {
			kind: "resume",
			name: resume.name,
			updatedAt: resume.updatedAt,
			locked: resume.isLocked,
			applicationId: resume.applicationId,
			passages,
			data: resume.data,
			read: (target) => readTarget(resume.data, target),
			view: { resume: buildMarkdown(resume.data) },
		};
	}

	const letter = await coverLetterService.getById({ id: document.id, userId });
	const passages = collectLetterPassages(letter.content, { ...LABELS, body: "Letter" });
	// The letter's facts come from its resume.
	const resume = letter.sourceResumeId
		? await resumeService.getById({ id: letter.sourceResumeId, userId }).catch(() => null)
		: null;

	return {
		kind: "letter",
		name: letter.name,
		updatedAt: letter.updatedAt,
		locked: letter.isLocked,
		applicationId: letter.sourceApplicationId,
		passages,
		letter: {
			name: letter.name,
			recipient: letter.recipient,
			recipientName: letter.recipientName,
			recipientCompany: letter.recipientCompany,
			letterDate: letter.letterDate ?? "",
		},
		read: (target) => (target.field === "content" ? letter.content : undefined),
		view: {
			sender: letter.style.basics.name,
			recipient:
				letter.layout === "structured"
					? { name: letter.recipientName, company: letter.recipientCompany, date: letter.letterDate }
					: blockText(letter.recipient),
			note: "The greeting and sign-off are added around the body automatically; propose edits to the body only.",
			...(resume ? { resume: buildMarkdown(resume.data) } : {}),
		},
	};
}

/** The read tool's result: the document's text and every passage an edit can target. */
export function documentView(document: LoadedDocument) {
	return {
		name: document.name,
		updatedAt: document.updatedAt.toISOString(),
		// `data` holds the snapshot; older snapshots are pruned from the model's context.
		data: {
			...document.view,
			passages: document.passages.map((passage) => ({
				id: passage.id,
				location: passage.location,
				text: passage.text || "(empty)",
			})),
			fields: fieldsOf(document),
		},
	};
}

const labelsFor = (data: ResumeData) => ({
	sectionTitle: (sectionId: string) => sectionTitle(data, sectionId),
	entryTitle: (entry: Record<string, unknown>) => entryTitle("", entry),
});

/** Every content field with its address: the resume's fields view, or a letter's header. */
function fieldsOf(document: LoadedDocument) {
	if (document.data) return fieldsView(document.data, labelsFor(document.data));
	if (document.letter)
		return {
			conventions: `Paths: ${LETTER_FIELD_PATHS.join(", ")}. The body is edited with propose_edits.`,
			...document.letter,
		};
	return undefined;
}

/** The posting of the application the document is for: its role, company and description or requirements. */
export async function findPosting(
	userId: string,
	documentId: string,
	loaded: Pick<LoadedDocument, "kind" | "applicationId">,
	applicationId?: string,
) {
	// A resume made for an application says so; otherwise, the latest application it's linked to.
	const selectedId = applicationId ?? loaded.applicationId;
	if (!selectedId && loaded.kind === "letter") return null;
	const table = schema.application;
	const [application] = await db
		.select({
			role: table.role,
			company: table.company,
			jobDescription: table.jobDescription,
			requirements: table.requirements,
			notes: table.notes,
		})
		.from(table)
		.where(and(eq(table.userId, userId), selectedId ? eq(table.id, selectedId) : eq(table.resumeId, documentId)))
		.orderBy(desc(table.updatedAt))
		.limit(1);
	if (!application) return null;

	const text =
		application.jobDescription?.trim() ||
		(application.requirements.length > 0 ? application.requirements.map((item) => `- ${item}`).join("\n") : "");
	return { role: application.role, company: application.company, text, notes: application.notes?.trim() ?? "" };
}

/**
 * Places the model's edits on the document as it is now. An edit whose passage id no longer exists (the words
 * changed since the document was read) is skipped, with a reason the model can act on.
 */
export function resolveEdits(document: LoadedDocument, input: ProposeEditsInput): ProposeEditsOutput {
	const byId = new Map(document.passages.map((passage) => [passage.id, passage]));
	const edits: ProposeEditsOutput["edits"] = [];
	const skipped: ProposeEditsOutput["skipped"] = [];

	for (const edit of input.edits) {
		const passage = byId.get(edit.passageId);
		if (!passage) {
			skipped.push({
				passageId: edit.passageId,
				reason: "No passage has this id now: the document changed since it was read. Read it again.",
			});
			continue;
		}
		if (!canApplyTo(document.read(passage.target), { before: passage.html })) {
			skipped.push({
				passageId: edit.passageId,
				reason: "This passage is ambiguous or changed. Edit its repeated text manually, or read the document again.",
			});
			continue;
		}

		if (edit.remove && !passage.html) {
			skipped.push({ passageId: edit.passageId, reason: "This passage is empty: there is nothing to remove." });
			continue;
		}
		const placed = edit.remove
			? removalOf(document.read(passage.target) ?? "", passage.html)
			: edit.add
				? additionAfter(document.read(passage.target) ?? "", passage.html, edit.text ?? "")
				: { before: passage.html, after: replaceBlockText(passage.html, edit.text ?? "") };
		if (!placed || placed.after === placed.before) {
			skipped.push({ passageId: edit.passageId, reason: "The edit doesn't change the passage." });
			continue;
		}

		edits.push({
			id: generateId(),
			target: passage.target,
			location: passage.location,
			before: placed.before,
			after: placed.after,
			why: edit.why,
			status: "pending",
		});
	}

	return { title: input.title, edits, skipped };
}

/** Resolves field changes against the document as it is now; a change that can't be placed is skipped with a reason. */
export function resolveChanges(document: LoadedDocument, input: ProposeChangesInput): ProposeChangesOutput {
	const proposals: ProposeChangesOutput["proposals"] = [];
	const skipped: ProposeChangesOutput["skipped"] = [];

	input.changes.forEach((change, index) => {
		if (document.data) {
			const result = resolvePatchProposal(document.data, change, labelsFor(document.data), generateId());
			if ("reason" in result) skipped.push({ index, reason: result.reason });
			else proposals.push(result.proposal as ProposeChangesOutput["proposals"][number]);
			return;
		}
		if (!document.letter) {
			skipped.push({ index, reason: "No document is open." });
			return;
		}
		const header = document.letter;
		const bad = change.operations.find(
			(op) => op.op !== "replace" || !(LETTER_FIELD_PATHS as readonly string[]).includes(op.path),
		);
		if (bad) {
			skipped.push({
				index,
				reason: `${bad.path}: only replace on a letter header field (${LETTER_FIELD_PATHS.join(", ")}); the body is edited with propose_edits.`,
			});
			return;
		}
		const notText = change.operations.find((op) => !("value" in op) || typeof op.value !== "string");
		if (notText) {
			skipped.push({ index, reason: `${notText.path}: letter header fields are text; send a string value.` });
			return;
		}
		let after: LetterHeader;
		try {
			after = applyPatchTo(header, change.operations);
		} catch (error) {
			skipped.push({ index, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) });
			return;
		}
		const changes = change.operations.map((op) => {
			const field = op.path.slice(1) as keyof LetterHeader;
			return {
				path: op.path,
				label: `Letter · ${LETTER_LABELS[field] ?? field}`,
				before: displayValue(header[field]),
				after: displayValue(after[field]),
			};
		});
		const first = changes[0];
		const firstOp = change.operations[0];
		if (!first || !firstOp || JSON.stringify(after) === JSON.stringify(header)) {
			skipped.push({ index, reason: "The change doesn't change anything." });
			return;
		}
		proposals.push({
			id: generateId(),
			kind: "patch",
			target: { sectionId: "letter", field: firstOp.path.slice(1) },
			location: first.label,
			before: first.before,
			after: first.after,
			why: change.why,
			status: "pending",
			operations: withPreconditions(header, change.operations),
			changes,
		});
	});

	return { title: input.title, proposals, skipped };
}

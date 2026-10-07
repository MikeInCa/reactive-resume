// Shared typed contracts for the assistant's tools. Zod is the only runtime import — the
// "ai" package is a devDependency used with `import type` only, so this file stays
// runtime-universal (consumed by both the API tool definitions and the web chat UI).
import type { UIDataTypes, UIMessage } from "ai";
import z from "zod";
import { jsonPatchOperationSchema } from "@reactive-resume/resume/patch";

export const askUserQuestionInputSchema = z.object({
	question: z.string().trim().min(1),
	choices: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
	recommendedChoice: z.string().trim().optional(),
	applyChanges: z
		.boolean()
		.optional()
		.describe(
			"Make the FIRST choice apply every pending proposed change in this conversation. Only after the user asked to go ahead.",
		),
});

export const searchWebInputSchema = z.object({
	query: z.string().trim().min(1).max(500),
});
export const readPageInputSchema = z.object({ url: z.url().max(2_048) });
export const searchWebOutputSchema = z.array(
	z.object({
		url: z.string(),
		title: z.string(),
		snippet: z.string().optional(),
	}),
);
export const readPageOutputSchema = z.object({
	requestedUrl: z.string(),
	resolvedUrl: z.string().optional(),
	content: z.string(),
	format: z.enum(["text", "markdown"]),
	retrievedAt: z.iso.datetime({ offset: true }),
	providerFetchedAt: z.iso.datetime({ offset: true }).optional(),
	method: z.enum(["builtin", "firecrawl", "tavily", "exa"]),
	truncated: z.boolean(),
	completeness: z.enum(["unknown", "incomplete"]),
	fallbackReason: z.string().optional(),
});
export type SearchWebOutput = z.infer<typeof searchWebOutputSchema>;
export type ReadPageOutput = z.infer<typeof readPageOutputSchema>;

export type AgentWebSource = {
	url: string;
	title: string;
	kind: "native" | "search" | "page";
};

// Link validation only; the server reader additionally checks DNS and redirects before fetching.
function publicSourceUrl(value: string): string | null {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/\.$/, "");
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
		// Source links use public hostnames. Reject IP literals and local names instead of guessing IP ranges in the browser.
		if (
			!host.includes(".") ||
			/^[\d.]+$/.test(host) ||
			host.includes(":") ||
			/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host) ||
			host.endsWith(".home.arpa")
		)
			return null;
		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

/** Sources from successful retrieval and native source parts, never links invented in response text. */
export function agentWebSources(message: UIMessage): AgentWebSource[] {
	const sources = new Map<string, AgentWebSource>();
	const add = (value: string, title: string, kind: AgentWebSource["kind"]) => {
		const url = publicSourceUrl(value);
		if (url && !sources.has(url)) sources.set(url, { url, title: title.trim() || url, kind });
	};
	for (const part of message.parts) {
		if (part.type === "source-url") {
			add(part.url, part.title ?? "", "native");
			continue;
		}
		const toolPart = part as { state?: string; output?: unknown };
		if (toolPart.state !== "output-available") continue;
		if (part.type === "tool-search_web") {
			const parsed = searchWebOutputSchema.safeParse(toolPart.output);
			if (parsed.success) for (const result of parsed.data) add(result.url, result.title, "search");
		} else if (part.type === "tool-read_page") {
			const parsed = readPageOutputSchema.safeParse(toolPart.output);
			if (parsed.success) add(parsed.data.resolvedUrl ?? parsed.data.requestedUrl, "", "page");
		}
	}
	return [...sources.values()];
}

/** One edit: rewrite a passage of the document, add a new passage after it, or remove it. */
export const proposedEditInputSchema = z
	.object({
		passageId: z.string().trim().min(1).describe("The id of a passage from read_resume or read_letter."),
		text: z
			.string()
			.trim()
			.min(1)
			.max(2_000)
			.optional()
			.describe(
				"The passage as it should read, in plain text: the rewrite, or the new passage to add. Omit when removing.",
			),
		why: z.string().trim().min(1).max(240).describe("One short line on why."),
		add: z.boolean().optional().describe("Add `text` as a new passage after this one, instead of replacing it."),
		remove: z.boolean().optional().describe("Remove this passage instead of rewriting it. Needs no `text`."),
	})
	.refine((edit) => edit.remove || edit.text !== undefined, { message: "`text` is required unless `remove` is true." })
	.refine((edit) => !(edit.remove && edit.add), { message: "An edit either removes a passage or adds one, not both." });

export const proposeEditsInputSchema = z.object({
	title: z.string().trim().min(1).max(80).describe('What the edits do together, e.g. "Tailor to the Lumen posting".'),
	edits: z.array(proposedEditInputSchema).min(1).max(12),
});

const proposalTargetSchema = z.object({
	sectionId: z.string(),
	itemId: z.string().optional(),
	roleId: z.string().optional(),
	field: z.string(),
});

/** An edit as proposed, resolved against the document: it replaces `before` with `after`. */
export const proposedEditSchema = z.object({
	id: z.string(),
	target: proposalTargetSchema,
	location: z.string(),
	before: z.string(),
	after: z.string(),
	why: z.string(),
	status: z.enum(["pending", "accepted", "rejected"]),
});

export const proposeEditsOutputSchema = z.looseObject({
	title: z.string(),
	edits: z.array(proposedEditSchema),
	/** Edits that couldn't be placed: the passage wasn't found (the document changed since it was read). */
	skipped: z.array(z.object({ passageId: z.string(), reason: z.string() })),
});

/** One change to any content field: JSON Patch operations, resolved and described by the server. */
export const proposedChangeInputSchema = z.object({
	why: z.string().trim().min(1).max(240).describe("One short line on why."),
	operations: z
		.array(jsonPatchOperationSchema)
		.min(1)
		.max(20)
		.describe(
			"JSON Patch (RFC 6902) operations rooted at the resume data, e.g. replace /sections/experience/items/0/position.",
		),
});

export const proposeChangesInputSchema = z.object({
	title: z.string().trim().min(1).max(80).describe('What the changes do together, e.g. "Match the posting\'s titles".'),
	changes: z.array(proposedChangeInputSchema).min(1).max(12),
});

export const proposalChangeRowSchema = z.object({
	path: z.string(),
	label: z.string(),
	before: z.string(),
	after: z.string(),
});

export const patchProposalSchema = proposedEditSchema.extend({
	kind: z.literal("patch"),
	operations: z.array(jsonPatchOperationSchema),
	changes: z.array(proposalChangeRowSchema),
});

export const proposeChangesOutputSchema = z.looseObject({
	title: z.string(),
	proposals: z.array(patchProposalSchema),
	/** Changes that couldn't be placed, by their index in the call, with a reason the model can act on. */
	skipped: z.array(z.object({ index: z.number(), reason: z.string() })),
});

export const readSchemaInputSchema = z.object({
	section: z
		.string()
		.trim()
		.min(1)
		.describe(
			"A section type: experience, education, projects, skills, languages, interests, awards, certifications, publications, volunteer, references, profiles, summary.",
		),
});

// All-optional and loose: legacy rows have no metadata and must keep rendering.
// The usage shape mirrors the AI SDK's LanguageModelUsage (nested token details).
export const agentMessageMetadataSchema = z
	.looseObject({
		model: z.string().optional(),
		provider: z.string().optional(),
		usage: z
			.looseObject({
				inputTokens: z.number().optional(),
				outputTokens: z.number().optional(),
				totalTokens: z.number().optional(),
				inputTokenDetails: z
					.looseObject({
						noCacheTokens: z.number().optional(),
						cacheReadTokens: z.number().optional(),
						cacheWriteTokens: z.number().optional(),
					})
					.optional(),
				outputTokenDetails: z
					.looseObject({
						textTokens: z.number().optional(),
						reasoningTokens: z.number().optional(),
					})
					.optional(),
			})
			.optional(),
	})
	.optional();

export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;
export type ProposeEditsInput = z.infer<typeof proposeEditsInputSchema>;
export type ProposedEdit = z.infer<typeof proposedEditSchema>;
export type ProposeEditsOutput = z.infer<typeof proposeEditsOutputSchema>;
export type ProposeChangesInput = z.infer<typeof proposeChangesInputSchema>;
export type ProposeChangesOutput = z.infer<typeof proposeChangesOutputSchema>;
export type PatchProposal = z.infer<typeof patchProposalSchema>;
export type ReadSchemaInput = z.infer<typeof readSchemaInputSchema>;
export type AgentMessageMetadata = z.infer<typeof agentMessageMetadataSchema>;

export type AgentTools = {
	ask_user_question: { input: AskUserQuestionInput; output: string };
	read_resume: { input: Record<string, never>; output: unknown };
	read_letter: { input: Record<string, never>; output: unknown };
	read_attachment: { input: { attachmentId: string }; output: unknown };
	propose_edits: { input: ProposeEditsInput; output: ProposeEditsOutput };
	propose_changes: { input: ProposeChangesInput; output: ProposeChangesOutput };
	read_schema: { input: ReadSchemaInput; output: unknown };
	search_web: {
		input: z.infer<typeof searchWebInputSchema>;
		output: SearchWebOutput;
	};
	read_page: {
		input: z.infer<typeof readPageInputSchema>;
		output: ReadPageOutput;
	};
	// Provider-native search names remain readable in existing conversations.
	web_search: { input: unknown; output: unknown };
	google_search: { input: unknown; output: unknown };
};

export type AgentUIMessage = UIMessage<AgentMessageMetadata, UIDataTypes, AgentTools>;

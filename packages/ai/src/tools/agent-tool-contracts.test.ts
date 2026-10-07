import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import {
	agentWebSources,
	askUserQuestionInputSchema,
	proposeChangesInputSchema,
	proposeChangesOutputSchema,
	proposedEditInputSchema,
} from "./agent-tool-contracts";

it("preserves deduplicated retrieved sources after serialization and ignores failed tools and invented links", () => {
	const message: UIMessage = {
		id: "message",
		role: "assistant",
		parts: [
			{ type: "text", text: "Made-up citation: https://invented.example/page" },
			{ type: "source-url", sourceId: "native", url: "https://company.example/job#requirements", title: "Company job" },
			{ type: "source-url", sourceId: "private", url: "http://127.0.0.1/secret" },
			{ type: "source-url", sourceId: "js", url: "javascript:alert(1)" },
			{ type: "source-url", sourceId: "credentials", url: "https://secret@company.example/job" },
			{
				type: "tool-search_web",
				toolCallId: "search",
				state: "output-available",
				input: { query: "Job" },
				output: [
					{ url: "https://company.example/job", title: "Duplicate" },
					{ url: "https://careers.example/role", title: "Role" },
				],
			},
			{ type: "tool-search_web", toolCallId: "failed", state: "output-error", input: {}, errorText: "Unavailable" },
			{
				type: "tool-read_page",
				toolCallId: "read",
				state: "output-available",
				input: { url: "https://careers.example/role" },
				output: {
					requestedUrl: "https://careers.example/role",
					resolvedUrl: "https://careers.example/role",
					content: "Posting",
					format: "text",
					retrievedAt: "2026-09-30T12:00:00Z",
					method: "builtin",
					truncated: false,
					completeness: "unknown",
				},
			},
		],
	};
	expect(agentWebSources(JSON.parse(JSON.stringify(message)))).toEqual([
		{ url: "https://company.example/job", title: "Company job", kind: "native" },
		{ url: "https://careers.example/role", title: "Role", kind: "search" },
	]);
});

it("accepts a removal without text, and requires text otherwise", () => {
	expect(proposedEditInputSchema.safeParse({ passageId: "p_1", why: "Repeats bullet 2.", remove: true }).success).toBe(
		true,
	);
	expect(proposedEditInputSchema.safeParse({ passageId: "p_1", why: "Clearer." }).success).toBe(false);
	expect(proposedEditInputSchema.safeParse({ passageId: "p_1", why: "Clearer.", text: "New" }).success).toBe(true);
	// One edit does one thing.
	expect(
		proposedEditInputSchema.safeParse({ passageId: "p_1", why: "Both.", text: "New", remove: true, add: true }).success,
	).toBe(false);
});

it("accepts a propose_changes call, bounds it, and an apply-all question", () => {
	expect(
		proposeChangesInputSchema.safeParse({
			title: "Tailor",
			changes: [{ why: "Posting title.", operations: [{ op: "replace", path: "/basics/headline", value: "PM" }] }],
		}).success,
	).toBe(true);
	expect(proposeChangesInputSchema.safeParse({ title: "x", changes: [] }).success).toBe(false);
	expect(
		proposeChangesInputSchema.safeParse({
			title: "x",
			changes: [{ why: "y", operations: [{ op: "replace", path: "/a" }] }],
		}).success,
	).toBe(false);
	expect(
		proposeChangesOutputSchema.safeParse({
			title: "Tailor",
			proposals: [
				{
					id: "c1",
					kind: "patch",
					target: { sectionId: "basics", field: "headline" },
					location: "Basics · Headline",
					before: "a",
					after: "b",
					why: "w",
					status: "pending",
					operations: [{ op: "replace", path: "/basics/headline", value: "b" }],
					changes: [{ path: "/basics/headline", label: "Basics · Headline", before: "a", after: "b" }],
				},
			],
			skipped: [{ index: 1, reason: "nope" }],
		}).success,
	).toBe(true);
	expect(
		askUserQuestionInputSchema.safeParse({
			question: "Apply all 3 changes?",
			choices: ["Apply all 3", "Let me pick"],
			applyChanges: true,
		}).success,
	).toBe(true);
});

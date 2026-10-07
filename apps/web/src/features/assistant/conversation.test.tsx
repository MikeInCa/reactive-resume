// @vitest-environment happy-dom
import type { AssistantDocument } from "./document";
import type { Proposal } from "@reactive-resume/resume/proposals";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const mocks = vi.hoisted(() => ({
	chat: vi.fn(),
	send: vi.fn(),
	attach: vi.fn(),
	publish: vi.fn(),
	addToolOutput: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/features/resume/editor/store", () => ({
	useEditorStore: (select: (state: unknown) => unknown) => select({ setAssistantProposals: mocks.publish }),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { agent: { attachments: { create: mocks.attach }, messages: { setEditStatus: async () => ({}) } } },
	orpc: { agent: { threads: { list: { key: () => ["threads"] } } } },
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
vi.mock("./chat", () => ({
	useAssistantChat: mocks.chat,
	fileToBase64: async () => "Zm9v",
	attachmentPart: (file: { id: string; filename: string; mediaType: string }) => ({
		type: "file",
		url: `agent-attachment:${file.id}`,
		filename: file.filename,
		mediaType: file.mediaType,
	}),
	transcriptOf: () => "",
}));

import { Composer, Conversation } from "./conversation";

const document: AssistantDocument = {
	kind: "resume",
	id: "resume-1",
	name: "Resume",
	locked: false,
	posting: { id: "application-2", company: "Selected Company", role: "Engineer" },
	stateOf: () => "pending",
	accept: () => [],
	locationOf: () => undefined,
};
beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.chat.mockReturnValue({ messages: [], sendMessage: mocks.send, status: "ready", clearError: vi.fn() });
	mocks.attach.mockResolvedValue({ id: "file-1", filename: "posting.txt", mediaType: "text/plain" });
});
afterEach(cleanup);

it("uploads a file in the initial composer before sending its first message", async () => {
	const ensureThread = vi.fn(async () => "draft-thread");
	const send = vi.fn();
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<Composer
				document={document}
				context={{ document: false, posting: false }}
				onContextChange={() => {}}
				providerLabel="Local"
				streaming={false}
				disabled={false}
				threadId={null}
				ensureThread={ensureThread}
				onSend={send}
				onStop={() => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.getByRole("button", { name: "Attach a file" })).toBeDefined();
	const input = container.querySelector('input[type="file"]');
	if (!input) throw new Error("File picker missing");
	fireEvent.change(input, { target: { files: [new File(["foo"], "posting.txt", { type: "text/plain" })] } });
	await waitFor(() => expect(screen.getByText("posting.txt")).toBeDefined());
	expect(mocks.attach).toHaveBeenCalledWith({
		threadId: "draft-thread",
		filename: "posting.txt",
		mediaType: "text/plain",
		data: "Zm9v",
	});
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Review this posting" } });
	fireEvent.click(screen.getByRole("button", { name: "Send" }));
	expect(send).toHaveBeenCalledWith("Review this posting", [
		{ id: "file-1", filename: "posting.txt", mediaType: "text/plain" },
	]);
});

it("preserves first-message context exclusions, selected application and attachment IDs", async () => {
	const context = { document: false, posting: true, applicationId: "application-2" };
	render(
		<I18nProvider i18n={i18n}>
			<Conversation
				document={document}
				threadId="thread-1"
				initialMessages={[]}
				activeRun={false}
				readOnly={false}
				providerLabel="Local"
				initialContext={context}
				prompt="Prepare"
				promptAttachments={[{ id: "file-1", filename: "posting.txt", mediaType: "text/plain" }]}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	await waitFor(() =>
		expect(mocks.send).toHaveBeenCalledWith(
			{ text: "Prepare", files: [expect.objectContaining({ url: "agent-attachment:file-1" })] },
			{ body: { attachmentIds: ["file-1"] } },
		),
	);
	expect(mocks.chat.mock.calls[0]?.[0].context).toEqual(context);
});

it("reopens native and custom web results with sources, clipping and failed or unfinished tool status", () => {
	const messages = [
		{
			id: "web-history",
			role: "assistant",
			parts: [
				{ type: "tool-web_search", toolCallId: "old-native", state: "output-available", input: {}, output: {} },
				{ type: "source-url", sourceId: "native", url: "https://company.example/job", title: "Company role" },
				{
					type: "tool-search_web",
					toolCallId: "failed",
					state: "output-error",
					input: {},
					errorText: "Enhanced access quota exhausted",
				},
				{ type: "tool-google_search", toolCallId: "stopped", state: "input-available", input: {} },
				{
					type: "tool-read_page",
					toolCallId: "read",
					state: "output-available",
					input: { url: "https://careers.example/role" },
					output: {
						requestedUrl: "https://careers.example/role",
						content: "Description",
						format: "text",
						method: "builtin",
						retrievedAt: "2026-09-30T12:00:00Z",
						truncated: true,
						completeness: "incomplete",
					},
				},
			],
		},
	];
	mocks.chat.mockReturnValue({ messages, status: "ready", clearError: vi.fn() });
	render(
		<I18nProvider i18n={i18n}>
			<Conversation
				document={document}
				threadId="thread-1"
				initialMessages={[]}
				activeRun={false}
				readOnly={false}
				providerLabel="Local"
				initialContext={{ document: true, posting: true }}
				prompt={null}
				promptAttachments={[]}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.getAllByText("Searched the web")).toHaveLength(1);
	expect(screen.getByRole("alert").textContent).toContain("Enhanced access quota exhausted");
	expect(screen.getByText("Web search didn't finish.")).toBeDefined();
	expect(screen.getByText("This page is clipped or incomplete. Check the original before using it.")).toBeDefined();
	expect(screen.getByRole("link", { name: "Company role" }).getAttribute("href")).toBe("https://company.example/job");
	expect(screen.getByRole("link", { name: "https://careers.example/role" }).getAttribute("href")).toBe(
		"https://careers.example/role",
	);
});

it("renders propose_changes cards and applies every pending card from the apply-all question's first choice", async () => {
	const accept = vi.fn((chosen: readonly Proposal[]) => chosen);
	const stateOf = vi.fn(() => "pending" as const);
	const proposals = [
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
	];
	mocks.chat.mockReturnValue({
		messages: [
			{
				id: "a1",
				role: "assistant",
				parts: [
					{
						type: "tool-propose_changes",
						toolCallId: "t1",
						state: "output-available",
						input: {},
						output: { title: "Tailor", proposals, skipped: [] },
					},
				],
			},
			{
				id: "a2",
				role: "assistant",
				parts: [
					{
						type: "tool-ask_user_question",
						toolCallId: "q1",
						state: "input-available",
						input: { question: "Apply all 1 changes?", choices: ["Apply all 1", "Let me pick"], applyChanges: true },
					},
				],
			},
		],
		sendMessage: mocks.send,
		status: "ready",
		clearError: vi.fn(),
		addToolOutput: mocks.addToolOutput,
		regenerate: vi.fn(),
		stop: vi.fn(),
		error: undefined,
	});
	render(
		<I18nProvider i18n={i18n}>
			<Conversation
				threadId="t"
				initialMessages={[]}
				activeRun={false}
				document={{ ...document, accept, stateOf }}
				readOnly={false}
				providerLabel="Local"
				prompt={null}
				promptAttachments={[]}
				initialContext={{ document: true, posting: true }}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.getAllByText("Basics · Headline").length).toBeGreaterThanOrEqual(1);
	fireEvent.click(screen.getByRole("button", { name: "Apply all 1" }));
	await waitFor(() => expect(accept).toHaveBeenCalledWith([expect.objectContaining({ id: "c1" })]));
	expect(mocks.addToolOutput).toHaveBeenCalledWith({
		tool: "ask_user_question",
		toolCallId: "q1",
		output: "Apply all 1 — applied 1 change; 0 were out of date.",
	});
});

it("reports a card the batch could not apply, and leaves it unrecorded", async () => {
	const accept = vi.fn(() => []); // nothing applied (its precondition failed inside the batch)
	const stateOf = vi.fn(() => "pending" as const);
	const proposals = [
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
	];
	mocks.chat.mockReturnValue({
		messages: [
			{
				id: "a1",
				role: "assistant",
				parts: [
					{
						type: "tool-propose_changes",
						toolCallId: "t1",
						state: "output-available",
						input: {},
						output: { title: "T", proposals, skipped: [] },
					},
				],
			},
			{
				id: "a2",
				role: "assistant",
				parts: [
					{
						type: "tool-ask_user_question",
						toolCallId: "q1",
						state: "input-available",
						input: { question: "Apply all 1 changes?", choices: ["Apply all 1", "Let me pick"], applyChanges: true },
					},
				],
			},
		],
		sendMessage: mocks.send,
		status: "ready",
		clearError: vi.fn(),
		addToolOutput: mocks.addToolOutput,
		regenerate: vi.fn(),
		stop: vi.fn(),
		error: undefined,
	});
	render(
		<I18nProvider i18n={i18n}>
			<Conversation
				threadId="t"
				initialMessages={[]}
				activeRun={false}
				document={{ ...document, accept, stateOf }}
				readOnly={false}
				providerLabel="Local"
				prompt={null}
				promptAttachments={[]}
				initialContext={{ document: true, posting: true }}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Apply all 1" }));
	await waitFor(() => expect(accept).toHaveBeenCalledOnce());
	expect(mocks.addToolOutput).toHaveBeenCalledWith({
		tool: "ask_user_question",
		toolCallId: "q1",
		output: "Apply all 1 — applied 0 changes; 0 were out of date; 1 could not be applied.",
	});
	expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy(); // the card is still pending, not Applied
});

it("scopes apply-all to what was proposed since the last answered apply-all question", async () => {
	const accept = vi.fn((chosen: readonly Proposal[]) => chosen);
	const stateOf = vi.fn(() => "pending" as const);
	const card = (id: string) => ({
		id,
		kind: "patch",
		target: { sectionId: "basics", field: "headline" },
		location: "Basics · Headline",
		before: "a",
		after: id,
		why: "w",
		status: "pending",
		operations: [{ op: "replace", path: "/basics/headline", value: id }],
		changes: [{ path: "/basics/headline", label: "Basics · Headline", before: "a", after: id }],
	});
	const question = (toolCallId: string, answered: boolean) => ({
		type: "tool-ask_user_question",
		toolCallId,
		state: answered ? "output-available" : "input-available",
		input: { question: "Apply all 1 changes?", choices: ["Apply all 1", "Let me pick"], applyChanges: true },
		...(answered ? { output: "Let me pick" } : {}),
	});
	mocks.chat.mockReturnValue({
		messages: [
			{
				id: "a1",
				role: "assistant",
				parts: [
					{
						type: "tool-propose_changes",
						toolCallId: "t1",
						state: "output-available",
						input: {},
						output: { title: "T", proposals: [card("old")], skipped: [] },
					},
				],
			},
			{ id: "a2", role: "assistant", parts: [question("q1", true)] },
			{ id: "u2", role: "user", parts: [{ type: "text", text: "now change it to new" }] },
			{
				id: "a3",
				role: "assistant",
				parts: [
					{
						type: "tool-propose_changes",
						toolCallId: "t2",
						state: "output-available",
						input: {},
						output: { title: "T2", proposals: [card("new")], skipped: [] },
					},
				],
			},
			{ id: "a4", role: "assistant", parts: [question("q2", false)] },
		],
		sendMessage: mocks.send,
		status: "ready",
		clearError: vi.fn(),
		addToolOutput: mocks.addToolOutput,
		regenerate: vi.fn(),
		stop: vi.fn(),
		error: undefined,
	});
	render(
		<I18nProvider i18n={i18n}>
			<Conversation
				threadId="t"
				initialMessages={[]}
				activeRun={false}
				document={{ ...document, accept, stateOf }}
				readOnly={false}
				providerLabel="Local"
				prompt={null}
				promptAttachments={[]}
				initialContext={{ document: true, posting: true }}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Apply all 1" }));
	await waitFor(() => expect(accept).toHaveBeenCalledOnce());
	expect(accept.mock.calls[0]?.[0].map((proposal) => proposal.id)).toEqual(["new"]);
});

// @vitest-environment happy-dom
import type { Proposal } from "@reactive-resume/resume/proposals";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

vi.mock("../store", () => ({ useEditorStore: (select: (state: unknown) => unknown) => select({}) }));
vi.mock("@/features/resume/builder/draft", () => ({ useIsResumeLocked: () => false, useResumeStore: {} }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

import { ChangeSet } from "./proposal-list";

const base: Proposal = {
	id: "1",
	target: { sectionId: "experience", itemId: "kettle", field: "description" },
	location: "Experience · Studio Kettle · bullet 1",
	before: "<li><p>Responsible for various design tasks</p></li>",
	after: "",
	why: "Repeats bullet 2.",
	status: "pending",
	source: "assistant",
};

beforeEach(() => i18n.loadAndActivate({ locale: "en-US", messages: {} }));
afterEach(cleanup);

it("shows a removal as the old text struck through with a Remove label, and no new text", () => {
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<ChangeSet proposals={[base]} states={["pending"]} locked={false} onAccept={() => {}} onReject={() => {}} />
		</I18nProvider>,
	);
	expect(container.querySelector("del")?.textContent).toBe("Responsible for various design tasks");
	expect(container.querySelector("ins")).toBeNull();
	expect(screen.getByText("Remove this passage")).toBeTruthy();
});

it("shows a rewrite as the old and new text", () => {
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<ChangeSet
				proposals={[{ ...base, after: "<li><p>Shipped print work for 12 retail clients</p></li>" }]}
				states={["pending"]}
				locked={false}
				onAccept={() => {}}
				onReject={() => {}}
			/>
		</I18nProvider>,
	);
	expect(container.querySelector("ins")?.textContent).toBe("Shipped print work for 12 retail clients");
	expect(screen.queryByText("Remove this passage")).toBeNull();
});

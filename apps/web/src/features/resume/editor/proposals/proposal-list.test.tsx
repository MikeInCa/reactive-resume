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

it("shows a patch proposal as its change rows", () => {
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<ChangeSet
				proposals={[
					{
						...base,
						kind: "patch",
						before: "Junior Designer",
						after: "Product Designer",
						location: "Experience · Studio Kettle · Position",
						operations: [],
						changes: [
							{
								path: "/sections/experience/items/0/position",
								label: "Experience · Studio Kettle · Position",
								before: "Junior Designer",
								after: "Product Designer",
							},
							{ path: "/sections/skills/items/-", label: "Skills", before: "", after: "Add entry “Terraform”" },
						],
					},
				]}
				states={["pending"]}
				locked={false}
				onAccept={() => {}}
				onReject={() => {}}
			/>
		</I18nProvider>,
	);
	expect(container.querySelectorAll("del")).toHaveLength(1);
	expect(container.querySelector("del")?.textContent).toBe("Junior Designer");
	expect(screen.getByText("Product Designer")).toBeTruthy();
	expect(screen.getByText("Add entry “Terraform”")).toBeTruthy();
	expect(screen.getByText("Skills")).toBeTruthy();
});

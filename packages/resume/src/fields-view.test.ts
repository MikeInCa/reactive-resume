import { expect, it } from "vitest";
import { experienceItemSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { fieldsView } from "./fields-view";

it("lists basics, every section and entry with paths, flags hidden ones and names HTML fields", () => {
	const d = structuredClone(defaultResumeData);
	d.basics.name = "Ada";
	d.sections.experience.items = [
		experienceItemSchema.parse({
			id: "e1",
			hidden: true,
			company: "Kettle",
			position: "Lead",
			location: "",
			period: "",
			description: "<p>x</p>",
			website: { url: "", label: "" },
			roles: [],
		}),
	];
	const view = fieldsView(d, { sectionTitle: (id) => id, entryTitle: (e) => String(e.company ?? e.name ?? "") });
	expect(view.conventions).toMatch(/JSON Pointer/);
	expect(view.conventions).toMatch(/"2022-03"/);
	expect(view.basics).toMatchObject({ path: "/basics", name: "Ada" });
	const experience = view.sections.find((s) => s.id === "experience");
	expect(experience).toMatchObject({
		path: "/sections/experience",
		type: "experience",
		items: [{ id: "e1", path: "/sections/experience/items/0", hidden: true, title: "Kettle" }],
	});
	expect(experience?.items[0]?.fields).toMatchObject({
		company: "Kettle",
		position: "Lead",
		description: "(rich text: see passages)",
	});
	expect(experience?.items[0]?.fields).toHaveProperty("dates");
	expect(experience?.items[0]?.fields).not.toHaveProperty("period");
});

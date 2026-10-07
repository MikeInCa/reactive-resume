import type { ResumeData } from "@reactive-resume/schema/resume/data";

const HTML_FIELDS = new Set(["content", "description"]);
const GENERATED = new Set(["period", "date"]);
const HTML_NOTE = "(rich text: see passages)";

export const FIELDS_CONVENTIONS =
	"Paths are JSON Pointers (RFC 6901) rooted at the resume data: /basics/headline, /sections/experience/items/0/position, /customSections/0/items/2/name. " +
	'Write dates as `dates` { start: "2022-03" | "2022" | null, end: "2022-03" | null, present: boolean, raw?: string }; never write period or date text. ' +
	"A new entry needs every field of its type (call read_schema) plus a UUID id and hidden: false; append with …/items/-. " +
	"Rich-text fields (summaries, descriptions) are edited with propose_edits by passage id, not here.";

type Labels = { sectionTitle: (sectionId: string) => string; entryTitle: (entry: Record<string, unknown>) => string };

type Entry = Record<string, unknown>;

function fieldsOf(entry: Entry): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(entry)) {
		if (key === "id" || key === "hidden" || GENERATED.has(key)) continue;
		if (HTML_FIELDS.has(key)) fields[key] = HTML_NOTE;
		else if (key === "roles" && Array.isArray(value))
			fields.roles = value.map((role, index) => ({
				path: `roles/${index}`,
				id: (role as { id?: string }).id,
				...fieldsOf(role as Entry),
			}));
		else fields[key] = value;
	}
	// A dated entry always shows its dates slot, even when it has only legacy period text.
	if (!("dates" in fields) && ("period" in entry || "date" in entry))
		fields.dates = { start: null, end: null, present: false, raw: String(entry.period ?? entry.date ?? "") };
	return fields;
}

export type FieldsView = ReturnType<typeof fieldsView>;

/** Every content field with its address, for the model; hidden sections and entries included and flagged. */
export function fieldsView(data: ResumeData, labels: Labels) {
	const section = (id: string, path: string, type: string, title: string, hidden: boolean, items: Entry[]) => ({
		id,
		path,
		type,
		title,
		hidden,
		items: items.map((item, index) => ({
			id: String(item.id ?? ""),
			path: `${path}/items/${index}`,
			hidden: item.hidden === true,
			title: labels.entryTitle(item),
			fields: fieldsOf(item),
		})),
	});
	return {
		conventions: FIELDS_CONVENTIONS,
		basics: { path: "/basics", ...data.basics },
		summary: { path: "/summary/content", hidden: data.summary.hidden, content: HTML_NOTE },
		sections: [
			...Object.entries(data.sections).map(([id, s]) =>
				section(id, `/sections/${id}`, id, labels.sectionTitle(id), s.hidden, s.items as unknown as Entry[]),
			),
			...data.customSections.map((s, index) =>
				section(
					s.id,
					`/customSections/${index}`,
					s.type,
					s.title || labels.sectionTitle(s.id),
					s.hidden,
					s.items as unknown as Entry[],
				),
			),
		],
	};
}

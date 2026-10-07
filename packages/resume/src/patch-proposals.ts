import type { JsonPatchOperation } from "./patch";
import type { Proposal, ProposalChange, ProposalTarget } from "./proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import jsonpatch from "fast-json-patch";
import { parseResumeDataForWrite } from "@reactive-resume/schema/resume/write";
import { applyResumePatches } from "./patch";
import { blockText } from "./proposals";

/** Content paths the assistant may change. Everything else is a reason it can't. */

const decode = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

const segmentsOf = (path: string) => (path === "" ? [] : path.slice(1).split("/").map(decode));

// Models often prefix paths with /data (read_resume nests the document under `data`) or drop /sections.
function normalizePath(data: { sections: Record<string, unknown> }, path: string): string {
	let next = path === "/data" ? "" : path.startsWith("/data/") ? path.slice("/data".length) : path;
	const [first] = segmentsOf(next);
	if (first && !next.startsWith("/sections/") && Object.hasOwn(data.sections, first)) next = `/sections${next}`;
	return next;
}

export function normalizePatchPaths(
	data: { sections: Record<string, unknown> },
	operations: JsonPatchOperation[],
): JsonPatchOperation[] {
	return operations.map((operation) => {
		const path = normalizePath(data, operation.path);
		const normalized = path === operation.path ? operation : { ...operation, path };
		if (!("from" in normalized)) return normalized;
		const from = normalizePath(data, normalized.from);
		return from === normalized.from ? normalized : { ...normalized, from };
	});
}

/** `null` when the path is a content field the assistant may change; otherwise the reason it may not. */
export function contentPathProblem(path: string): string | null {
	const s = segmentsOf(path);
	const [root] = s;
	if (s.length < 2) return "Change one field or entry, never the whole document or a whole section.";
	if (root === "metadata") return "Design settings (template, colours, fonts, layout) aren't editable here.";
	if (root === "picture") return "The picture isn't editable here.";
	if (root === "basics") return null;
	if (root === "summary")
		return s[1] === "content" ? null : "Section settings aren't editable here; only the summary's content is.";
	if (root === "sections" || root === "customSections") {
		// /sections/<id>/items/<i>/… or /customSections/<i>/items/<j>/…
		if (s[2] !== "items")
			return "Section settings (title, visibility, columns) aren't editable here; change its entries instead.";
		if (s.length === 3) return "Change one entry (…/items/<index> or …/items/-), never the whole list.";
		const last = s.at(-1);
		if ((last === "period" || last === "date") && s.length >= 5 && s[s.length - 2] !== "dates")
			return "Write `dates` ({ start, end, present, raw }); `period` and `date` text is generated from it.";
		return null;
	}
	return `Unknown path root "${root ?? ""}". Paths start at the resume data: /basics, /summary, /sections, /customSections.`;
}

export type ChangeLabels = {
	sectionTitle: (sectionId: string) => string;
	entryTitle: (entry: Record<string, unknown>) => string;
};

const FIELD_LABELS: Record<string, string> = {
	name: "Name",
	headline: "Headline",
	email: "Email",
	phone: "Phone",
	location: "Location",
	url: "Link",
	label: "Link label",
	text: "Text",
	link: "Link",
	content: "Content",
	company: "Company",
	position: "Position",
	dates: "Dates",
	description: "Description",
	school: "School",
	degree: "Degree",
	area: "Area of study",
	grade: "Grade",
	title: "Title",
	awarder: "Awarder",
	issuer: "Issuer",
	publisher: "Publisher",
	organization: "Organization",
	network: "Network",
	username: "Username",
	language: "Language",
	fluency: "Fluency",
	level: "Level",
	proficiency: "Proficiency",
	keywords: "Keywords",
	hidden: "Hidden",
	start: "Start",
	end: "End",
	present: "Present",
	raw: "Date text",
};
const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field.charAt(0).toUpperCase() + field.slice(1);

// A YearMonth is "2022" or "2022-03" (schema `yearMonthSchema`).
const yearMonth = (value: unknown) => (typeof value === "string" ? value : "");

/** A value as a card shows it: HTML as text, dates as "2016-01 – Present", objects compact, arrays joined. */
export function displayValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return /<[a-z][\s\S]*>/i.test(value) ? blockText(value) : value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return value.map(displayValue).join(", ");
	const v = value as Record<string, unknown>;
	if ("start" in v || "end" in v || "present" in v) {
		const start = yearMonth(v.start);
		const end = v.present ? "Present" : yearMonth(v.end);
		return typeof v.raw === "string" && v.raw ? v.raw : [start, end].filter(Boolean).join(" – ");
	}
	if ("url" in v) return String(v.label || v.url || "");
	return Object.values(v).map(displayValue).filter(Boolean).join(" · ");
}

const read = (document: unknown, path: string): unknown => {
	try {
		return jsonpatch.getValueByPointer(document, path);
	} catch {
		return undefined;
	}
};

/** `test` operations for what each change assumes about the document now, ahead of the change itself. */
export function withPreconditions(data: unknown, operations: JsonPatchOperation[]): JsonPatchOperation[] {
	const tests: JsonPatchOperation[] = [];
	const seen = new Set<string>();
	const test = (path: string) => {
		if (seen.has(path) || path.endsWith("/-")) return;
		const value = read(data, path);
		if (value === undefined) return;
		seen.add(path);
		tests.push({ op: "test", path, value: structuredClone(value) });
	};
	for (const operation of operations) {
		if (operation.op === "replace" || operation.op === "remove" || operation.op === "add") test(operation.path);
		if (operation.op === "move" || operation.op === "copy") test(operation.from);
	}
	return [...tests, ...operations];
}

// /sections/<id>/items/<i>[/roles/<j>][/<field>…]  or  /customSections/<i>/items/<j>/…  or  /basics/…  or  /summary/content
type Place = { sectionId: string; itemIndex?: number; roleIndex?: number; field?: string; rest: string[] };
function placeOf(path: string): Place {
	const s = segmentsOf(path);
	if (s[0] === "sections" || s[0] === "customSections") {
		const place: Place = { sectionId: s[1] ?? "", rest: [] };
		let i = 2;
		if (s[i] === "items") {
			place.itemIndex = Number(s[i + 1]);
			i += 2;
		}
		if (s[i] === "roles") {
			place.roleIndex = Number(s[i + 1]);
			i += 2;
		}
		const field = s[i];
		if (field !== undefined) place.field = field;
		place.rest = s.slice(i + 1);
		return place;
	}
	const place: Place = { sectionId: s[0] ?? "", rest: s.slice(2) };
	if (s[1] !== undefined) place.field = s[1];
	return place;
}

type Entry = Record<string, unknown>;

const sectionOf = (data: ResumeData, place: Place): { id?: string; items: Entry[] } | undefined =>
	Object.hasOwn(data.sections, place.sectionId)
		? (data.sections as unknown as Record<string, { items: Entry[] }>)[place.sectionId]
		: (data.customSections[Number(place.sectionId)] as unknown as { id: string; items: Entry[] } | undefined);

const entryOf = (data: ResumeData, place: Place): Entry | undefined =>
	place.itemIndex === undefined ? undefined : sectionOf(data, place)?.items[place.itemIndex];

const roleOf = (entry: Entry | undefined, place: Place): Entry | undefined =>
	entry && place.roleIndex !== undefined ? (entry.roles as Entry[] | undefined)?.[place.roleIndex] : undefined;

/** The proposal target (section, entry, role, field) a path points at, for section counts and locations. */
export function targetOf(path: string, data?: ResumeData): ProposalTarget {
	const place = placeOf(path);
	const entry = data ? entryOf(data, place) : undefined;
	const role = roleOf(entry, place);
	const custom =
		data && !Object.hasOwn(data.sections, place.sectionId) ? data.customSections[Number(place.sectionId)] : undefined;
	const target: ProposalTarget = {
		sectionId: custom ? custom.id : place.sectionId,
		field: place.field ?? (place.itemIndex === undefined ? "" : "items"),
	};
	if (typeof entry?.id === "string") target.itemId = entry.id;
	if (typeof role?.id === "string") target.roleId = role.id;
	return target;
}

/** One row per operation: the field's old and new value, or what happens to an entry. */
export function describeChanges(
	before: ResumeData,
	after: ResumeData,
	operations: JsonPatchOperation[],
	labels: ChangeLabels,
): ProposalChange[] {
	const rows: ProposalChange[] = [];
	for (const operation of operations) {
		if (operation.op === "test") continue;
		const place = placeOf(operation.path);
		const section =
			place.sectionId === "basics"
				? "Basics"
				: place.sectionId === "summary"
					? "Summary"
					: labels.sectionTitle(place.sectionId);
		const isEntry = place.itemIndex !== undefined && place.field === undefined;
		if (isEntry) {
			const value =
				operation.op === "remove"
					? read(before, operation.path)
					: operation.op === "move"
						? read(before, operation.from)
						: (operation as { value?: unknown }).value;
			const title = labels.entryTitle((value ?? {}) as Entry) || "entry";
			const row =
				operation.op === "add"
					? { before: "", after: `Add entry “${title}”` }
					: operation.op === "remove"
						? { before: `Remove entry “${title}”`, after: "" }
						: { before: "", after: `Move “${title}” to position ${(place.itemIndex ?? 0) + 1}` };
			rows.push({ path: operation.path, label: section, ...row });
			continue;
		}
		const entry = entryOf(before, place) ?? entryOf(after, place);
		const role = roleOf(entry, place);
		const label = [
			section,
			entry ? labels.entryTitle(entry) : "",
			role ? String(role.position ?? "") : "",
			fieldLabel(place.field ?? ""),
			...place.rest.filter((r) => !/^\d+$/.test(r)).map(fieldLabel),
		]
			.filter(Boolean)
			.join(" · ");
		rows.push({
			path: operation.path,
			label,
			before: displayValue(read(before, operation.path)),
			after: displayValue(read(after, operation.path)),
		});
	}
	return rows;
}

/** Normalises, bounds, dry-applies and describes one change; a problem comes back as a reason the model can act on. */
export function resolvePatchProposal(
	data: ResumeData,
	change: { operations: JsonPatchOperation[]; why: string },
	labels: ChangeLabels,
	id: string,
): { proposal: Proposal } | { reason: string } {
	const operations = normalizePatchPaths(data, change.operations);
	for (const operation of operations) {
		const problem =
			contentPathProblem(operation.path) ?? ("from" in operation ? contentPathProblem(operation.from) : null);
		if (problem) return { reason: `${operation.path}: ${problem}` };
	}
	// Both sides go through the write-time parse, so what it regenerates (period text from dates) isn't read as a change.
	let before: ResumeData;
	let after: ResumeData;
	try {
		before = parseResumeDataForWrite(data);
		after = applyResumePatches(data, operations);
	} catch (error) {
		return { reason: error instanceof Error ? error.message.slice(0, 300) : String(error) };
	}
	if (JSON.stringify(after) === JSON.stringify(before)) return { reason: "The change doesn't change anything." };
	const changes = describeChanges(before, after, operations, labels);
	const first = changes[0];
	const firstOp = operations.find((op) => op.op !== "test");
	if (!first || !firstOp) return { reason: "The change doesn't change anything." };
	return {
		proposal: {
			id,
			kind: "patch",
			target: targetOf(firstOp.path, data),
			location: first.label,
			before: first.before,
			after: first.after,
			why: change.why,
			status: "pending",
			source: "assistant",
			operations: withPreconditions(data, operations),
			changes,
		},
	};
}

/** The document with the operations applied (tests included), as a copy; throws when one fails. */
export function applyPatchTo<T>(document: T, operations: readonly JsonPatchOperation[]): T {
	return jsonpatch.applyPatch(structuredClone(document), [...operations], true, true).newDocument;
}

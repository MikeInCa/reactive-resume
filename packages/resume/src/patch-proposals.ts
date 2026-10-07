import type { JsonPatchOperation } from "./patch";

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

type NumberInputBounds = { min?: number; max?: number };

/**
 * Reads a `type="number"` input for a form field that persists straight into the resume draft.
 *
 * Returns `NaN` for an empty or unparsable value so the control can be cleared without persisting
 * anything (callers skip the autosave on `NaN`), and otherwise clamps to `[min, max]`: a browser lets
 * you type past a number input's `min`/`max`, and an out-of-range value in the draft makes every save
 * fail server validation with a 400 ("Not saved · Retry" with no field to blame).
 */
export function readNumberInput(raw: string, { min, max }: NumberInputBounds = {}): number {
	if (raw === "") return Number.NaN;
	const value = Number(raw);
	if (!Number.isFinite(value)) return Number.NaN;
	let clamped = value;
	if (min !== undefined) clamped = Math.max(clamped, min);
	if (max !== undefined) clamped = Math.min(clamped, max);
	return clamped;
}

/** The `value` to render for a number input whose field may hold `NaN` while the user clears it. */
export function numberInputValue(value: number): number | "" {
	return Number.isFinite(value) ? value : "";
}

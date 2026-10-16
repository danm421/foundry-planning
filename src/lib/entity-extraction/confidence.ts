/** Below this, a cell is marked for review in the table. */
export const REVIEW_THRESHOLD = 0.7;

/** A value that failed coercion, an enum or a range check cannot be trusted. */
export const INVALID_CAP = 0.3;
/** A value whose snippet is not in the document may have been invented. */
export const UNGROUNDED_CAP = 0.5;

/** PDF extraction breaks lines where the model does not. Compare on the words. */
export function normalizeForGrounding(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isGrounded(snippet: string | null, haystack: string): boolean {
  if (!snippet) return false;
  const needle = normalizeForGrounding(snippet);
  if (!needle) return false;
  return haystack.includes(needle);
}

/**
 * What counts as an account's masked number.
 *
 * A statement prints plenty of other digits the extractor is happy to copy
 * into `accountNumberLast4`: a 401(k)'s six-digit plan GROUP number, a
 * five-digit contract number, a three-digit sub-plan id. About 8% of extracted
 * rows carry one. They are not this account's identity, and anything that
 * keys on them as though they were folds unrelated accounts together.
 */

/**
 * The row's real masked account number, or null when the field holds
 * something that is not one. Exactly four digits — the same shape
 * `src/lib/crm/schemas.ts` already enforces on the CRM's own field.
 *
 * NOT `condense-account-name.ts`'s `normalizeLast4`, which takes the LAST four
 * characters of whatever it is given: that turns the group number "433350"
 * into a plausible-looking "3350" on purpose, because it is building a display
 * NAME ("ESOP x3350") and a wrong-looking suffix is better than none. This one
 * decides IDENTITY, where inventing four digits is how two accounts become
 * one.
 */
export function realLast4(raw: string | undefined): string | null {
  return raw !== undefined && /^\d{4}$/.test(raw) ? raw : null;
}

/**
 * The same decision as `realLast4`, but tolerant of the packaging a model
 * leaves around a number it read correctly: padding (`" 1234"`), or the mask
 * the statement printed in front of it (`"x1234"`, `"****1234"`, `"XXXX-1234"`).
 *
 * Only the WRAPPER is forgiven. Nothing here invents digits: "433350" is six
 * digits with no mask to strip and still returns null, and UBS's "IJ 58621 FI"
 * has no trailing four-digit run at all. That is the line `realLast4` draws and
 * this keeps — the point is to stop a correctly-read number from being thrown
 * away over a stray "x", not to widen what counts as a number.
 */
export function accountLast4(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return realLast4(raw.trim().replace(/^[x*.•\s#-]+/i, ""));
}

/**
 * Client-safe home for the holdings edit allowlist and its validators.
 *
 * `tools.ts` imports `{ db } from "@/db"` and is server-only; the review
 * table (`holdings-table.tsx`) is a `"use client"` component, so importing
 * these from `tools.ts` would drag the database client into the browser
 * bundle. This module has NO runtime imports, so it is safe from either
 * side — `tools.ts` re-exports these same symbols for every server-side
 * reference, so there is still exactly one definition of each.
 */

/**
 * Holdings get their OWN allowlist rather than a dotted path through the
 * account one. `isEditableField` guards a flat name because `edit_row`'s
 * field comes from the model (Ruling 50); a path that has to be PARSED
 * before it can be VALIDATED is exactly the shape an allowlist stops being
 * able to guard.
 */
export const EDITABLE_HOLDING_FIELDS = [
  "ticker",
  "name",
  "shares",
  "price",
  "marketValue",
  "costBasis",
] as const;
export type EditableHoldingField = (typeof EDITABLE_HOLDING_FIELDS)[number];

export function isEditableHoldingField(field: string): field is EditableHoldingField {
  return (EDITABLE_HOLDING_FIELDS as readonly string[]).includes(field);
}

/**
 * `ticker` and `name` are text; the other four are numbers. Mirrors
 * `isValidFieldValue` for accounts — the allowlist says WHICH columns are
 * writable, never that any scalar is legal in them. A numeric field that
 * accepted a string would be stored as one and later concatenated.
 */
export function isValidHoldingValue(field: EditableHoldingField, value: unknown): boolean {
  if (field === "ticker" || field === "name") return typeof value === "string";
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Human-readable domain description for an error message — mirrors
 * `fieldDomainDescription` in `tools.ts` for account fields (fix round 1,
 * Minor 2). Exhaustive over `EditableHoldingField` by construction (no
 * `default` case): a field added to the allowlist without a case here is a
 * compile error, not a silently wrong message baked into `editHolding` as an
 * inline ternary.
 */
export function holdingFieldDomainDescription(field: EditableHoldingField): string {
  switch (field) {
    case "ticker":
    case "name":
      return "text";
    case "shares":
    case "price":
    case "marketValue":
    case "costBasis":
      return "a number";
  }
}

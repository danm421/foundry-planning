// The portal's deny-list for incomes and expenses. A savings-rule write gets
// an ALLOWLIST (`portal-savings-input.ts`) because the form sends exactly four
// fields; incomes and expenses carry many more legitimate ones (name, amount,
// years, growth rate, owner tag, isGoal…), so allowlisting there risks
// breaking Tasks 8-10 every time the form grows a field. This module instead
// names the handful of fields that must never arrive from the portal and lets
// everything else through untouched.
//
// Those fields all point at accounts or entities: `ownerEntityId` /
// `ownerAccountId` (`assertEntitiesInClient` / `assertAccountsInClient` check
// only that the target belongs to the CLIENT, never that it is
// PORTAL-VISIBLE per `isPortalVisibleAccount`), `cashAccountId` and
// `dedicatedAccountIds` (which bucket a projection draws from), and
// `linkedPropertyId` (incomes only). Task 4 already ships these ids to the
// browser as opaque UUIDs — no names or balances, so reading them back is not
// a boundary breach — but accepting them back as write targets is: a client
// could redirect a living expense's funding account to a hidden business
// account or an engine cash bucket, or set `ownerEntityId`/`ownerAccountId`
// on create and tray the row they just made, permanently invisible and
// undeletable through the very endpoint that created it.
//
// Refuse, don't strip. A silent strip would let a client believe they saved a
// funding account that never landed.

/** The five advisor-only pointer fields, across both incomes and expenses.
 *  Kept in ONE place so POST and PUT cannot drift on which fields they check. */
export const PORTAL_REFUSED_FLOW_FIELDS = [
  "ownerEntityId",
  "ownerAccountId",
  "cashAccountId",
  "dedicatedAccountIds",
  "linkedPropertyId",
] as const;

/**
 * Returns the first refused field present in `input` with a non-null value,
 * or `null` when the body carries none of them.
 *
 * `null`/`undefined` are allowed for every field: a form that round-trips a
 * cleared value (or simply never renders the field) must not 400. An empty
 * `dedicatedAccountIds: []` is allowed for the same reason as null — it does
 * not point at anything, hidden or otherwise; only a non-empty array is an
 * actual attempt to wire up dedicated funding accounts.
 *
 * Pure and total: takes `unknown` because the body arrives unparsed, and
 * non-object input (`null`, an array, a primitive) is treated as carrying no
 * refused field rather than thrown — the write-core's own schema validation
 * is what answers for a malformed body.
 */
export function findRefusedFlowField(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const field of PORTAL_REFUSED_FLOW_FIELDS) {
    const value = record[field];
    if (value == null) continue;
    if (field === "dedicatedAccountIds" && Array.isArray(value) && value.length === 0) continue;
    return field;
  }
  return null;
}

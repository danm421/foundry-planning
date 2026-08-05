// The portal's savings DTO — the four keys the Organizer's savings form sends.
// Its own module rather than a member of `assert-portal-visible-target.ts`,
// which is named for a different job (the account gate); POST and PUT both
// import this one definition so the two paths cannot drift.
//
// This is the CREATE-side half of the portal's writability gate, and it is not
// tidiness. `isPortalWritableSavingsRule` refuses to let a client EDIT a rule
// that resolves to anything but a flat dollar amount — but the shared
// write-core accepts fourteen columns, and nothing stopped a hand-rolled POST
// from CREATING one of the excluded shapes in the first place. A client posting
// `{ accountId: <their own 401k>, contributeMax: true, ... }` gets a 201 and a
// rule that contributes the IRS maximum to their projection, which they then
// cannot see (`loadOrganizerMap` filters the board through the same predicate)
// and cannot remove (the item route 403s both PUT and DELETE). An invisible,
// undeletable, projection-altering row, created with the exact lever the
// predicate exists to withhold. PUT has the mirror-image hole: it could convert
// a writable flat-dollar rule into a permanently uneditable one.
//
// Refusing beats silently dropping. A client whose request carried an employer
// match should be told it did not save, not left believing it did.

/** Everything the portal savings form sends, and nothing else. Deliberately
 *  much narrower than `SavingsRuleInput` in `@/lib/clients/savings-rules-writes`,
 *  which is the ADVISOR's full surface. */
export const PORTAL_SAVINGS_INPUT_FIELDS = [
  "accountId",
  "annualAmount",
  "startYear",
  "endYear",
] as const;

export function assertPortalSavingsInput(
  input: unknown,
): { ok: true } | { ok: false; status: 400; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, status: 400, error: "Expected a JSON object body" };
  }
  const refused = Object.keys(input).filter(
    (key) => !(PORTAL_SAVINGS_INPUT_FIELDS as readonly string[]).includes(key),
  );
  if (refused.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Not editable from the portal: ${refused.join(", ")}`,
    };
  }
  return { ok: true };
}

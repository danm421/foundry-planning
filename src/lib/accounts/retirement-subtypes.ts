/**
 * The account sub-types the `account_owners_retirement_check` constraint
 * trigger holds to exactly one owner at 100%.
 *
 * Lives here, DB-free, rather than in `src/lib/ownership.ts` where it was
 * first defined: that module imports `@/db` and so can never be reached from a
 * client component, and an ownership PICKER has to know the same rule the
 * constraint enforces — otherwise it offers a joint split on an IRA that the
 * commit step silently collapses back to a single owner, which reads as a
 * control that does nothing. `ownership.ts` re-exports this, so the name every
 * server-side caller already imports is unchanged.
 */
export const RETIREMENT_SUBTYPES = [
  "traditional_ira",
  "roth_ira",
  "401k",
  "403b",
] as const;

// src/engine/socialSecurity/claimAge.ts
import type { Income, ClientInfo } from "../types";
import { fraForBirthDate } from "./fra";
import { ssEntitlementMonth, type EntitlementMonth } from "./entitlement";

/**
 * Resolve the effective claim age for a Social Security income row in
 * total months (years*12 + months). Returns null when the mode is
 * unresolvable (e.g., "fra" mode with missing DOB, or "at_retirement"
 * for a spouse with no spouseRetirementAge). Callers treat null as
 * "not yet claimed" — no benefit is emitted.
 *
 * @param row  The SS income row. Uses `claimingAgeMode`, `claimingAge`, `claimingAgeMonths`, `owner`.
 * @param client  The household `ClientInfo`. Uses `dateOfBirth`, `spouseDob`, `retirementAge`, `spouseRetirementAge` depending on mode + owner.
 */
export function resolveClaimAgeMonths(row: Income, client: ClientInfo): number | null {
  const mode = row.claimingAgeMode ?? "years";

  if (mode === "fra") {
    const dob = row.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
    if (!dob) return null;
    return fraForBirthDate(dob).totalMonths;
  }

  if (mode === "at_retirement") {
    const age = row.owner === "spouse" ? client.spouseRetirementAge : client.retirementAge;
    if (age == null) return null;
    return age * 12;
  }

  // "years" — existing behavior, including legacy rows where claimingAgeMode IS NULL
  if (row.claimingAge == null) return null;
  return row.claimingAge * 12 + (row.claimingAgeMonths ?? 0);
}

/**
 * Resolve the first calendar MONTH a Social Security row pays out, combining
 * the row's claim-age mode with the owner's date of birth.
 *
 * `resolveClaimAgeMonths` answers "at what age?", which only ever pins down a
 * calendar year. This answers "starting when?", which is what the projection
 * needs to prorate the claim year instead of paying twelve months of benefit
 * to someone who turned 67 in December.
 *
 * Returns null when the claim age is unresolvable OR the owner has no date of
 * birth on file — both mean "not yet claimed" to callers.
 *
 * @param row The SS income row. Uses `owner` plus the claim-age fields.
 * @param client The household `ClientInfo`. Uses `dateOfBirth` / `spouseDob`.
 */
export function resolveEntitlementMonth(row: Income, client: ClientInfo): EntitlementMonth | null {
  const claimAgeMonths = resolveClaimAgeMonths(row, client);
  if (claimAgeMonths == null) return null;
  const dob = row.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
  if (!dob) return null;
  return ssEntitlementMonth(dob, claimAgeMonths);
}

// src/engine/socialSecurity/claimAge.ts
import type { Income, ClientInfo } from "../types";
import { fraForBirthDate } from "./fra";

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

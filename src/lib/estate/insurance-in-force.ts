import type { Account } from "@/engine/types";

/**
 * Returns true if the policy would pay out its face value if death occurred
 * in `year`. Used by the Liquidity report to decide whether to include the
 * policy's death benefit in the year's totals.
 *
 * Rules:
 * - Term: in force iff `year ≥ termIssueYear`, AND — when a fixed
 *   `termLengthYears` is set — `year < termIssueYear + termLengthYears`,
 *   AND (if `endsAtInsuredRetirement`) `year < insuredRetirementYear`.
 *   A "term to retirement" policy carries no `termLengthYears`; it relies
 *   solely on the retirement bound. A term policy with neither a length nor
 *   a retirement rule is malformed and treated as never in force.
 * - Whole / UL / Variable: always in force unless
 *   `endsAtInsuredRetirement && year ≥ insuredRetirementYear`.
 *
 * `insuredRetirementYear` resolved by caller from `account.insuredPerson`.
 * Pass `null` if the insured is unknown / has no retirement age — the
 * `endsAtInsuredRetirement` check is then bypassed (treated as "doesn't end").
 */
export function isPolicyInForce(
  account: Account,
  year: number,
  insuredRetirementYear: number | null,
): boolean {
  if (account.category !== "life_insurance" || !account.lifeInsurance) {
    return false;
  }
  const p = account.lifeInsurance;

  if (p.policyType === "term") {
    // A term policy needs a start year, and either a fixed length OR an
    // ends-at-retirement rule. "Term to retirement" policies legitimately
    // carry no `termLengthYears` — the retirement check below bounds them.
    if (p.termIssueYear == null) return false;
    if (year < p.termIssueYear) return false;
    if (p.termLengthYears != null) {
      if (year >= p.termIssueYear + p.termLengthYears) return false;
    } else if (!p.endsAtInsuredRetirement) {
      return false; // no fixed length and no retirement rule → malformed
    }
  }

  if (
    p.endsAtInsuredRetirement &&
    insuredRetirementYear != null &&
    year >= insuredRetirementYear
  ) {
    return false;
  }

  return true;
}

/**
 * Resolve the retirement year of an insurance policy's insured person. Used by
 * callers of `isPolicyInForce` to gate the `endsAtInsuredRetirement` rule.
 *
 * Takes pre-computed retirement years for the client and spouse (the caller
 * derives these from `ownerDobs` + `clientData.client.retirementAge` /
 * `spouseRetirementAge`) and selects the right one for `account.insuredPerson`:
 *
 * - `"client"` → `clientRetirementYear`
 * - `"spouse"` → `spouseRetirementYear`
 * - `"joint"` → the later of the two (policy lapses only when both have
 *   retired); falls back to whichever side is non-null if the other is null
 * - anything else (including `null`/`undefined`) → `null`
 *
 * Callers treat `null` as "no retirement bound" and continue applying any
 * explicit term-length rule.
 */
export function insuredRetirementYearFor(
  account: Account,
  clientRetirementYear: number | null,
  spouseRetirementYear: number | null,
): number | null {
  switch (account.insuredPerson) {
    case "client":
      return clientRetirementYear;
    case "spouse":
      return spouseRetirementYear;
    case "joint":
      // Policy lapses only when BOTH have retired, so use the later year.
      if (clientRetirementYear == null) return spouseRetirementYear;
      if (spouseRetirementYear == null) return clientRetirementYear;
      return Math.max(clientRetirementYear, spouseRetirementYear);
    default:
      return null;
  }
}

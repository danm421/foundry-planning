import type { Account } from "@/engine/types";

/**
 * Returns true if the policy would pay out its face value if death occurred
 * in `year`. Used by the Liquidity report to decide whether to include the
 * policy's death benefit in the year's totals.
 *
 * Rules:
 * - Term: in force iff `termIssueYear ≤ year < termIssueYear + termLengthYears`,
 *   AND (if `endsAtInsuredRetirement`) `year < insuredRetirementYear`.
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
    if (p.termIssueYear == null || p.termLengthYears == null) return false;
    if (year < p.termIssueYear) return false;
    if (year >= p.termIssueYear + p.termLengthYears) return false;
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

import type { SavingsRule } from "./types";

interface SavingsResult {
  byAccount: Record<string, number>;
  total: number;
  employerTotal: number;
}

/**
 * Annual employer match for a rule, given the salary the match is based on.
 * Priority order:
 *   1. Flat dollar amount (employerMatchAmount) — absolute $, wins if set.
 *   2. Pct + cap style   (pct × cap × salary) — "50% match up to 6% of salary".
 *   3. Pct only          (pct × salary)        — "3% of salary, flat".
 *   4. Nothing           → 0.
 * The caller decides which salary stream is the base (typically the salary
 * owned by whoever owns the retirement account the rule targets).
 */
export function computeEmployerMatch(rule: SavingsRule, salaryBase: number): number {
  if (rule.employerMatchAmount != null && rule.employerMatchAmount > 0) {
    return rule.employerMatchAmount;
  }
  if (rule.employerMatchPct == null) return 0;
  if (rule.employerMatchCap != null) {
    return salaryBase * rule.employerMatchCap * rule.employerMatchPct;
  }
  return salaryBase * rule.employerMatchPct;
}

// Apply savings rules at their full annual amount.
// The projection engine funds these contributions from the household checking account,
// which may require pulling from the withdrawal strategy if the balance would go negative.
export function applySavingsRules(
  rules: SavingsRule[],
  year: number,
  totalSalaryIncome: number,
  // Optional cap used only by the legacy path (no default checking account defined).
  availableSurplus?: number
): SavingsResult {
  const byAccount: Record<string, number> = {};
  let total = 0;
  let employerTotal = 0;
  const legacyCap = availableSurplus;
  let remaining = legacyCap != null ? Math.max(0, legacyCap) : Number.POSITIVE_INFINITY;

  for (const rule of rules) {
    if (year < rule.startYear || year > rule.endYear) continue;
    if (remaining <= 0) break;

    const baseAmount = rule.scheduleOverrides
      ? (rule.scheduleOverrides.get(year) ?? 0)
      : rule.annualAmount;
    if (baseAmount === 0) continue;
    const contribution = Math.min(baseAmount, remaining);

    byAccount[rule.accountId] = (byAccount[rule.accountId] ?? 0) + contribution;
    total += contribution;
    if (legacyCap != null) remaining -= contribution;

    // Employer match is not funded from household cash — it's a gift from the employer
    // deposited directly into the account. For the running total here we use the full
    // salary base; the projection engine recomputes per-rule matches using the
    // account-owner's salary slice for accurate deposits.
    employerTotal += computeEmployerMatch(rule, totalSalaryIncome);
  }

  return { byAccount, total, employerTotal };
}

import type { SavingsRule, ClientInfo } from "./types";
import { itemProrationGate } from "./retirement-proration";

interface SavingsResult {
  byAccount: Record<string, number>;
  total: number;
  employerTotal: number;
}

/**
 * Resolve a savings rule's employee contribution to a dollar amount for a given year.
 *   - If `annualPercent` is set (percent-of-salary mode), returns `salary × annualPercent`.
 *     When there's no salary (`salary <= 0`), returns 0.
 *   - Otherwise returns `annualAmount` (flat-dollar mode).
 * The caller supplies the salary base (typically the account owner's salary slice).
 */
export function resolveContributionAmount(rule: SavingsRule, salary: number): number {
  if (rule.annualPercent != null && rule.annualPercent > 0) {
    return salary > 0 ? salary * rule.annualPercent : 0;
  }
  return rule.annualAmount;
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
  client: ClientInfo,
  // Optional cap used only by the legacy path (no default checking account defined).
  availableSurplus?: number,
  // Optional per-rule salary base for percent-mode contributions. Keyed by rule id.
  // When a rule has annualPercent set, the resolver uses this salary. Falls back
  // to totalSalaryIncome if the rule isn't in the map.
  salaryByRuleId?: Record<string, number>,
  // Optional pre-resolved (and possibly contribution-limit-capped) amount per
  // rule. When present, overrides both scheduleOverrides and percent-mode
  // resolution for this rule. Caller is responsible for already honoring
  // scheduleOverrides when building this map.
  overriddenAmountByRuleId?: Record<string, number>
): SavingsResult {
  const byAccount: Record<string, number> = {};
  let total = 0;
  let employerTotal = 0;
  const legacyCap = availableSurplus;
  let remaining = legacyCap != null ? Math.max(0, legacyCap) : Number.POSITIVE_INFINITY;

  for (const rule of rules) {
    const gate = itemProrationGate(rule, year, client);
    if (!gate.include) continue;
    if (remaining <= 0) break;

    const ruleSalary = salaryByRuleId?.[rule.id] ?? totalSalaryIncome;
    const overridden = overriddenAmountByRuleId?.[rule.id];
    const baseAmount =
      overridden != null
        ? overridden
        : rule.scheduleOverrides
          ? (rule.scheduleOverrides[year] ?? 0)
          : resolveContributionAmount(rule, ruleSalary);
    if (baseAmount === 0) continue;
    const proratedBase = baseAmount * gate.factor;
    const contribution = Math.min(proratedBase, remaining);

    byAccount[rule.accountId] = (byAccount[rule.accountId] ?? 0) + contribution;
    total += contribution;
    if (legacyCap != null) remaining -= contribution;

    // Employer match is not funded from household cash — it's a gift from the employer
    // deposited directly into the account. For the running total here we use the full
    // salary base; the projection engine recomputes per-rule matches using the
    // account-owner's salary slice for accurate deposits.
    // The percentage paths use the (already-prorated) salary, so re-applying
    // gate.factor here would double-prorate. Flat-dollar matches are prorated
    // explicitly so the total mirrors the salary-driven cases in retirement year.
    if (rule.employerMatchAmount != null && rule.employerMatchAmount > 0) {
      employerTotal += rule.employerMatchAmount * gate.factor;
    } else {
      employerTotal += computeEmployerMatch(rule, totalSalaryIncome);
    }
  }

  return { byAccount, total, employerTotal };
}

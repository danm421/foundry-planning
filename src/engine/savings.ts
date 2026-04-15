import type { SavingsRule } from "./types";

interface SavingsResult {
  byAccount: Record<string, number>;
  total: number;
  employerTotal: number;
}

// Apply savings rules at their full annual amount (respecting the optional annualLimit).
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

    let contribution = Math.min(rule.annualAmount, remaining);
    if (rule.annualLimit != null) {
      contribution = Math.min(contribution, rule.annualLimit);
    }

    byAccount[rule.accountId] = (byAccount[rule.accountId] ?? 0) + contribution;
    total += contribution;
    if (legacyCap != null) remaining -= contribution;

    // Employer match is not funded from household cash — it's a gift from the employer
    // deposited directly into the account.
    if (rule.employerMatchPct != null && rule.employerMatchCap != null) {
      const matchableAmount = totalSalaryIncome * rule.employerMatchCap;
      const employerMatch = matchableAmount * rule.employerMatchPct;
      employerTotal += employerMatch;
    }
  }

  return { byAccount, total, employerTotal };
}

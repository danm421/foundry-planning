import type { SavingsRule } from "./types";

interface SavingsResult {
  byAccount: Record<string, number>;
  total: number;
  employerTotal: number;
}

export function applySavingsRules(
  rules: SavingsRule[],
  year: number,
  availableSurplus: number,
  totalSalaryIncome: number
): SavingsResult {
  const byAccount: Record<string, number> = {};
  let total = 0;
  let employerTotal = 0;
  let remaining = Math.max(0, availableSurplus);

  for (const rule of rules) {
    if (year < rule.startYear || year > rule.endYear) continue;
    if (remaining <= 0) break;

    let contribution = Math.min(rule.annualAmount, remaining);
    if (rule.annualLimit != null) {
      contribution = Math.min(contribution, rule.annualLimit);
    }

    byAccount[rule.accountId] = (byAccount[rule.accountId] ?? 0) + contribution;
    total += contribution;
    remaining -= contribution;

    // Employer match
    if (rule.employerMatchPct != null && rule.employerMatchCap != null) {
      const matchableAmount = totalSalaryIncome * rule.employerMatchCap;
      const employerMatch = matchableAmount * rule.employerMatchPct;
      employerTotal += employerMatch;
    }
  }

  return { byAccount, total, employerTotal };
}

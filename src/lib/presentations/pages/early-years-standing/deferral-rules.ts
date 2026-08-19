// Which accounts the report treats as payroll deferrals — the accounts a
// "save 3% more" instruction actually moves.
//
// A rule already in percent-of-salary mode is one by definition. A flat-dollar
// rule is converted to its implied percent so a client whose 401(k) was entered
// as "$1,000/month" still gets a ladder. With no salary there is nothing to take
// a percent OF, so the rule is skipped and the page prints its empty state.

import type { ClientData, Income } from "@/engine/types";
import { activeIncomes } from "@/lib/solver/active-incomes";

export interface DeferralAccount {
  accountId: string;
  /** Fraction of salary, 0–1 — the SUM of every active rule on this account. */
  currentPercent: number;
  /** How many savings rules feed this account in the given year. */
  ruleCount: number;
}

/**
 * One entry per ACCOUNT, not per rule.
 *
 * The ladder moves an account with the `savings-annual-percent` mutation, and
 * `applyMutations` sets that percent on EVERY rule sharing the accountId. Two
 * rules on one account would therefore each be raised to the target and the
 * household would defer twice what the rung says. Callers that mutate must
 * check `ruleCount === 1`; `currentPercent` is summed so the reported rate is
 * still the truth about what the household defers today.
 *
 * `year` filters on each rule's own start/end window: a rule that begins in
 * 2032 is not a deferral the client is making now.
 */
export function deferralAccounts(data: ClientData, year: number): DeferralAccount[] {
  const salary = householdSalary(data.incomes ?? [], year);
  const byAccount = new Map<string, DeferralAccount>();

  for (const rule of data.savingsRules ?? []) {
    if (rule.startYear > year || rule.endYear < year) continue;

    let percent: number | null = null;
    if (rule.annualPercent != null && rule.annualPercent > 0) {
      percent = rule.annualPercent;
    } else if (salary > 0 && rule.annualAmount > 0) {
      percent = rule.annualAmount / salary;
    }
    if (percent == null) continue;

    const existing = byAccount.get(rule.accountId);
    if (existing) {
      existing.currentPercent += percent;
      existing.ruleCount += 1;
    } else {
      byAccount.set(rule.accountId, {
        accountId: rule.accountId,
        currentPercent: percent,
        ruleCount: 1,
      });
    }
  }

  return [...byAccount.values()];
}

/** Gross salary the household earns in `year`. Salary rows only — a percent-of-
 *  salary deferral is a payroll deduction, so business, trust and other income
 *  are not part of the base it is taken from. */
function householdSalary(incomes: Income[], year: number): number {
  return activeIncomes(incomes, year)
    .filter((i) => i.type === "salary")
    .reduce((sum, i) => sum + i.annualAmount, 0);
}

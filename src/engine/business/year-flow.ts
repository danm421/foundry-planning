import type { Account, AccountFlowOverride, Expense, Income } from "../types";

/**
 * Resolve the year's gross income, expenses, and distribution percent for a
 * top-level business account, branching on its `flowMode`:
 *   - "schedule": pull cells from `accountFlowOverrides`. Missing rows or null
 *     income/expense fields resolve to 0. `distPercent` falls back to
 *     account-level `distributionPolicyPercent` then 1.0.
 *   - "annual" (default): existing behavior — sum income/expense rows tagged
 *     with `ownerAccountId`, applying inflation/growth. `distPercent` from
 *     account-level field, default 1.0.
 *
 * Lives in `engine/business/` (not directly in `projection.ts`) so the entity
 * cashflow pass can import it without forming a cycle through projection.
 */
export function computeBusinessYearFlow(
  business: Account,
  year: number,
  currentIncomes: readonly Income[],
  allExpenses: readonly Expense[],
  accountFlowOverrides: AccountFlowOverride[] | undefined,
): { gross: number; exp: number; distPercent: number } {
  const accountDistDefault = business.distributionPolicyPercent ?? 1.0;
  if (business.flowMode === "schedule") {
    const ovr = (accountFlowOverrides ?? []).find(
      (r) => r.accountId === business.id && r.year === year,
    );
    return {
      gross: ovr?.incomeAmount ?? 0,
      exp: ovr?.expenseAmount ?? 0,
      distPercent: ovr?.distributionPercent ?? accountDistDefault,
    };
  }
  let gross = 0;
  for (const inc of currentIncomes) {
    if (inc.ownerAccountId !== business.id) continue;
    if (year < inc.startYear || year > inc.endYear) continue;
    const inflateFrom = inc.inflationStartYear ?? inc.startYear;
    gross += inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
  }
  let exp = 0;
  for (const e of allExpenses) {
    if (e.ownerAccountId !== business.id) continue;
    if (year < e.startYear || year > e.endYear) continue;
    const inflateFrom = e.inflationStartYear ?? e.startYear;
    exp += e.annualAmount * Math.pow(1 + e.growthRate, year - inflateFrom);
  }
  return { gross, exp, distPercent: accountDistDefault };
}

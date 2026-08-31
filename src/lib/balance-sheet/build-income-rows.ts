// src/lib/balance-sheet/build-income-rows.ts
import type { Income } from "@/engine/types";
import type { IncomeRow } from "@/components/balance-sheet-view";

/**
 * Scenario-effective engine incomes → the rows `BalanceSheetView` renders.
 *
 * Shared rather than mapped inline at each producer: the Net Worth page and
 * the onboarding wizard's Accounts/Liabilities steps both feed the same view,
 * and both mount the Add/Edit Account dialog. A producer that dropped `type`
 * or `owner` would not fail — `toSalaryOptions` would simply match nothing and
 * the savings rule's Salary basis panel would tell the advisor the plan has no
 * salaries, on a plan that has them.
 *
 * `?? null` where the engine leaves a field undefined: the row type is what
 * crosses the server→client boundary, and `undefined` does not survive
 * serialization as a distinct value.
 */
export function buildIncomeRows(incomes: readonly Income[]): IncomeRow[] {
  return incomes.map((i) => ({
    id: i.id,
    type: i.type,
    name: i.name,
    annualAmount: i.annualAmount,
    owner: i.owner,
    ownerEntityId: i.ownerEntityId ?? null,
    ownerAccountId: i.ownerAccountId ?? null,
    startYear: i.startYear,
    endYear: i.endYear,
    growthRate: i.growthRate,
    inflationStartYear: i.inflationStartYear ?? null,
  }));
}

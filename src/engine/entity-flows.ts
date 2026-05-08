import type { Income, Expense } from "./types";

/** Resolve an income or expense's amount for a given year, honoring per-row
 *  scheduleOverrides first, then the annualAmount × growth formula. Mirrors
 *  the resolution path used at projection.ts:1953 for non-grantor entity
 *  income outside computeIncome. */
function resolveAmount(
  row: { annualAmount: number; growthRate: number; startYear: number; inflationStartYear?: number; scheduleOverrides?: Record<number, number> },
  year: number,
): number {
  if (row.scheduleOverrides) {
    return row.scheduleOverrides[year] ?? 0;
  }
  const inflateFrom = row.inflationStartYear ?? row.startYear;
  return row.annualAmount * Math.pow(1 + row.growthRate, year - inflateFrom);
}

/** Sum of (income amounts − expense amounts) for the given business entity in
 *  year Y. Only counts rows where ownerEntityId matches and Y ∈ [startYear,
 *  endYear]. Negative result means the entity ran a loss this year (per P3-8
 *  losses are retained in the entity, not carried forward). */
export function computeBusinessEntityNetIncome(
  entityId: string,
  incomes: Income[],
  expenses: Expense[],
  year: number,
): number {
  let income = 0;
  for (const inc of incomes) {
    if (inc.ownerEntityId !== entityId) continue;
    if (year < inc.startYear || year > inc.endYear) continue;
    income += resolveAmount(inc, year);
  }
  let expense = 0;
  for (const exp of expenses) {
    if (exp.ownerEntityId !== entityId) continue;
    if (year < exp.startYear || year > exp.endYear) continue;
    expense += resolveAmount(exp, year);
  }
  return income - expense;
}

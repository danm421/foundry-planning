import type { Expense } from "./types";

interface ExpenseBreakdown {
  living: number;
  liabilities: number;
  other: number;
  insurance: number;
  total: number;
  bySource: Record<string, number>;
}

export function computeExpenses(
  expenses: Expense[],
  year: number,
  filter?: (exp: Expense) => boolean
): ExpenseBreakdown {
  const result: ExpenseBreakdown = {
    living: 0,
    liabilities: 0,
    other: 0,
    insurance: 0,
    total: 0,
    bySource: {},
  };

  for (const exp of expenses) {
    if (year < exp.startYear || year > exp.endYear) continue;
    if (filter && !filter(exp)) continue;

    let amount: number;
    if (exp.scheduleOverrides) {
      amount = exp.scheduleOverrides[year] ?? 0;
    } else {
      // Inflation compounds from `inflationStartYear` when set (today's-dollars
      // semantics), otherwise from the entry's own start year.
      const inflateFrom = exp.inflationStartYear ?? exp.startYear;
      const yearsElapsed = year - inflateFrom;
      amount = exp.annualAmount * Math.pow(1 + exp.growthRate, yearsElapsed);
    }
    result[exp.type] += amount;
    result.bySource[exp.id] = amount;
  }

  result.total = result.living + result.other + result.insurance;

  return result;
}

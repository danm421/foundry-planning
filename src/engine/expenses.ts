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
  year: number
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

    const yearsElapsed = year - exp.startYear;
    const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, yearsElapsed);
    result[exp.type] += amount;
    result.bySource[exp.id] = amount;
  }

  result.total = result.living + result.other + result.insurance;

  return result;
}

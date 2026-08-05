import type { IncomeReportRow } from "../income-report";

/**
 * A zeroed income-report row. Shared by the chart and the panel tests so a new
 * field on `IncomeReportRow` only needs a default in one place — a `Partial`
 * override would otherwise let one file's factory go stale without a type error.
 */
export function incomeRow(over: Partial<IncomeReportRow> = {}): IncomeReportRow {
  return {
    year: 2026,
    ages: { client: 65 },
    socialSecurity: 0,
    salaries: 0,
    otherIncome: 0,
    rmds: 0,
    totalIncome: 0,
    withdrawals: { cash: 0, taxable: 0, preTax: 0, roth: 0 },
    withdrawalsTotal: 0,
    livingExpenses: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    ...over,
  };
}

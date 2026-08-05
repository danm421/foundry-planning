import type { WithdrawalReportRow } from "../withdrawal-report";

/**
 * A zeroed withdrawal-report row. Shared by the chart and the panel tests so a
 * new field on `WithdrawalReportRow` only needs a default in one place — a
 * `Partial` override would otherwise let one file's factory go stale without a
 * type error.
 */
export function withdrawalRow(
  over: Partial<WithdrawalReportRow> = {},
): WithdrawalReportRow {
  return {
    year: 2026,
    ages: { client: 65 },
    totalIncome: 0,
    withdrawals: { cash: 0, taxable: 0, preTax: 0, roth: 0 },
    withdrawalsTotal: 0,
    portfolioBoy: 0,
    withdrawalRate: 0,
    livingExpenses: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    ...over,
  };
}

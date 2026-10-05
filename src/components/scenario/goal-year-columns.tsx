import type { YearTableColumn } from "@/components/scenario/year-table";
import type { CashFlowGoalReport, GoalReportRow } from "@/lib/reports/goal-report-data";
import { formatCurrency } from "@/components/monte-carlo/lib/format";

export function goalYearColumns(): YearTableColumn<GoalReportRow>[] {
  const money = (n: number) => formatCurrency(n);
  return [
    { key: "year", header: "Year", align: "left", render: (r) => r.year },
    { key: "boy", header: "Dedicated Assets (BOY)", align: "right", render: (r) => money(r.dedicatedAssetsBOY) },
    { key: "growth", header: "Dedicated Assets Growth & Savings", align: "right", render: (r) => money(r.growthAndSavings) },
    { key: "goal", header: "Goal Expense", align: "right", render: (r) => money(r.goalExpense) },
    { key: "other", header: "Other Expenses Flows", align: "right", render: (r) => money(r.otherExpenseFlows) },
    { key: "withdrawal", header: "Dedicated Withdrawals", align: "right", render: (r) => money(r.dedicatedWithdrawal) },
    { key: "cashFlow", header: "Cash-Flow Withdrawals", align: "right", render: (r) => money(r.outOfPocketWithdrawal ?? 0) },
    { key: "eoy", header: "Dedicated Assets (EOY)", align: "right", render: (r) => money(r.dedicatedAssetsEOY) },
    {
      key: "shortfall", header: "Shortfall", align: "right",
      render: (r) => money(r.shortfall),
      tone: (r) => (r.shortfall > 0 ? "crit" : "default"),
    },
  ];
}

/** Columns for a goal paid from cash flow (no savings account behind it). */
export function cashFlowGoalYearColumns(): YearTableColumn<CashFlowGoalReport["rows"][number]>[] {
  const money = (n: number) => formatCurrency(n);
  return [
    { key: "year", header: "Year", align: "left", render: (r) => r.year },
    { key: "cost", header: "Goal Expense", align: "right", render: (r) => money(r.cost) },
    { key: "funded", header: "Funded", align: "right", render: (r) => money(r.funded) },
  ];
}

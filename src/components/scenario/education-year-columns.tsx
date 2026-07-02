import type { YearTableColumn } from "@/components/scenario/year-table";
import type { EducationGoalReportRow } from "@/lib/reports/education-report-data";
import { formatCurrency } from "@/components/monte-carlo/lib/format";

export function educationYearColumns(): YearTableColumn<EducationGoalReportRow>[] {
  const money = (n: number) => formatCurrency(n);
  return [
    { key: "year", header: "Year", align: "left", render: (r) => r.year },
    { key: "boy", header: "Dedicated Assets (BOY)", align: "right", render: (r) => money(r.dedicatedAssetsBOY) },
    { key: "growth", header: "Dedicated Assets Growth & Savings", align: "right", render: (r) => money(r.growthAndSavings) },
    { key: "goal", header: "Goal Expense", align: "right", render: (r) => money(r.goalExpense) },
    { key: "other", header: "Other Expenses Flows", align: "right", render: (r) => money(r.otherExpenseFlows) },
    { key: "withdrawal", header: "Dedicated Withdrawals", align: "right", render: (r) => money(r.dedicatedWithdrawal) },
    { key: "eoy", header: "Dedicated Assets (EOY)", align: "right", render: (r) => money(r.dedicatedAssetsEOY) },
    {
      key: "shortfall", header: "Shortfall", align: "right",
      render: (r) => money(r.shortfall),
      tone: (r) => (r.shortfall > 0 ? "crit" : "default"),
    },
  ];
}

import type { YearTableColumn } from "@/components/analysis/analysis-year-table";
import type { ProjectionYear } from "@/engine/types";
import { formatCurrency } from "@/components/monte-carlo/lib/format";

/** Format a currency value using parenthesized notation for negatives,
 *  matching the eMoney accounting style.  Positive values use the standard
 *  formatCurrency output (which uses U+2212 for negatives — we avoid that
 *  path here by always passing Math.abs). */
function fmtAccounting(value: number): string {
  if (value < 0) return `(${formatCurrency(Math.abs(value))})`;
  return formatCurrency(value);
}

export function retirementYearColumns(
  hasSpouse: boolean
): YearTableColumn<ProjectionYear>[] {
  return [
    {
      key: "year",
      header: "Year",
      align: "left",
      render: (row) => row.year,
    },
    {
      key: "age",
      header: "Age",
      align: "left",
      render: (row) => {
        const client = row.ages.client;
        const spouse = row.ages.spouse;
        if (hasSpouse && spouse != null) return `${client}/${spouse}`;
        return `${client}`;
      },
    },
    {
      key: "socialSecurity",
      header: "Social Security",
      align: "right",
      render: (row) => formatCurrency(row.income.socialSecurity),
    },
    {
      key: "withdrawals",
      header: "Withdrawals",
      align: "right",
      render: (row) => formatCurrency(row.withdrawals.total),
    },
    {
      key: "totalIncomeWithdrawals",
      header: "Total Income & Withdrawals",
      align: "right",
      render: (row) =>
        formatCurrency(row.income.total + row.withdrawals.total),
    },
    {
      key: "livingExpenses",
      header: "Living Expenses",
      align: "right",
      render: (row) => formatCurrency(row.expenses.living),
    },
    {
      key: "taxes",
      header: "Taxes",
      align: "right",
      render: (row) => formatCurrency(row.expenses.taxes),
    },
    {
      key: "totalExpenses",
      header: "Total Expenses",
      align: "right",
      render: (row) => formatCurrency(row.totalExpenses),
    },
    {
      key: "shortfall",
      header: "Shortfall",
      align: "right",
      render: (row) => {
        const shortfall = Math.max(
          0,
          row.totalExpenses - row.income.total - row.withdrawals.total
        );
        return formatCurrency(shortfall);
      },
      tone: (row) => {
        const shortfall = Math.max(
          0,
          row.totalExpenses - row.income.total - row.withdrawals.total
        );
        return shortfall > 0 ? "crit" : "default";
      },
    },
    {
      key: "portfolioAssets",
      header: "Total Portfolio Assets",
      align: "right",
      render: (row) => fmtAccounting(row.portfolioAssets.total),
      tone: (row) => (row.portfolioAssets.total < 0 ? "crit" : "default"),
    },
  ];
}

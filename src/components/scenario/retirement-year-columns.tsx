import type { YearTableColumn } from "@/components/scenario/year-table";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import { retirementInflows } from "@/lib/retirement/retirement-inflows";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { buildYearCellDrill, type YearDrillColumnKey } from "@/lib/solver/year-cell-drill";
import type { CellDrillProps } from "@/lib/cell-drill/types";

/** Format a currency value using parenthesized notation for negatives,
 *  matching the eMoney accounting style.  Positive values use the standard
 *  formatCurrency output (which uses U+2212 for negatives — we avoid that
 *  path here by always passing Math.abs). */
function fmtAccounting(value: number): string {
  if (value < 0) return `(${formatCurrency(Math.abs(value))})`;
  return formatCurrency(value);
}

export function retirementYearColumns(
  hasSpouse: boolean,
  clientData?: ClientData,
): YearTableColumn<ProjectionYear>[] {
  // Per-cell drill factory — undefined (no drill affordance) when the caller
  // has no ClientData to resolve account/income/expense names against.
  const drill: (
    key: YearDrillColumnKey,
  ) => ((row: ProjectionYear) => CellDrillProps | null) | undefined = clientData
    ? (key) => (row) => buildYearCellDrill(key, row, clientData)
    : () => undefined;

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
      render: (row) => formatCurrency(retirementInflows(row).socialSecurity),
      drill: drill("socialSecurity"),
    },
    {
      key: "salaries",
      header: "Salaries",
      align: "right",
      render: (row) => formatCurrency(retirementInflows(row).salaries),
      drill: drill("salaries"),
    },
    {
      key: "otherIncome",
      header: "Other Income",
      align: "right",
      render: (row) => formatCurrency(retirementInflows(row).otherInflows),
      drill: drill("otherIncome"),
    },
    {
      key: "rmds",
      header: "RMDs",
      align: "right",
      render: (row) => formatCurrency(retirementInflows(row).rmds),
      drill: drill("rmds"),
    },
    {
      key: "withdrawals",
      header: "Withdrawals",
      align: "right",
      render: (row) => formatCurrency(retirementInflows(row).withdrawals),
      drill: drill("withdrawals"),
    },
    {
      // SS + salaries + other income + RMDs + withdrawals — the sum of the five
      // inflow bands above, matching the hero chart's stacked total.
      key: "totalIncomeWithdrawals",
      header: "Total Income & Withdrawals",
      align: "right",
      render: (row) => formatCurrency(retirementInflows(row).total),
      drill: drill("totalIncomeWithdrawals"),
    },
    {
      key: "livingExpenses",
      header: "Living Expenses",
      align: "right",
      render: (row) => formatCurrency(row.expenses.living),
      drill: drill("livingExpenses"),
    },
    {
      key: "taxes",
      header: "Taxes",
      align: "right",
      render: (row) => formatCurrency(row.expenses.taxes),
      drill: drill("taxes"),
    },
    {
      key: "totalExpenses",
      header: "Total Expenses",
      align: "right",
      render: (row) => formatCurrency(row.totalExpenses),
      drill: drill("totalExpenses"),
    },
    {
      key: "shortfall",
      header: "Shortfall",
      align: "right",
      render: (row) => formatCurrency(retirementInflows(row).shortfall),
      tone: (row) => (retirementInflows(row).shortfall > 0 ? "crit" : "default"),
      drill: drill("shortfall"),
    },
    {
      // Liquid portfolio (taxable + cash + retirement) — the same definition the
      // "Assets Remaining" headline + KPIs + Monte Carlo funding gate use, so the
      // last row of this column equals the headline. Excludes illiquid assets
      // (real estate, business) and life insurance.
      key: "portfolioAssets",
      header: "Total Portfolio Assets",
      align: "right",
      render: (row) => fmtAccounting(liquidPortfolioTotal(row)),
      tone: (row) => (liquidPortfolioTotal(row) < 0 ? "crit" : "default"),
      drill: drill("portfolioAssets"),
    },
  ];
}

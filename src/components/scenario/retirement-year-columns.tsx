import type { YearTableColumn } from "@/components/scenario/year-table";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import { isMaterialShortfall } from "@/lib/retirement/retirement-inflows";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { buildYearCellDrill, type YearDrillColumnKey } from "@/lib/solver/year-cell-drill";
import { yearCashFlow, type YearCashFlow } from "@/lib/solver/year-table-cash-flow";

/** Format a currency value using parenthesized notation for negatives,
 *  matching the eMoney accounting style.  Positive values use the standard
 *  formatCurrency output (which uses U+2212 for negatives — we avoid that
 *  path here by always passing Math.abs). A break-even year's float residue
 *  (−$0.30) rounds to "$0", never "($0)". */
function fmtAccounting(value: number): string {
  const rounded = Math.round(value);
  if (rounded < 0) return `(${formatCurrency(-rounded)})`;
  return formatCurrency(Math.abs(rounded));
}

interface MoneyColumn {
  key: YearDrillColumnKey;
  header: string;
  group?: "Cash In" | "Cash Out";
  tooltip?: string;
  value: (cf: YearCashFlow) => number;
  tone?: (cf: YearCashFlow) => "default" | "crit";
  /** Totals and the net always show; a component column that is $0 in every
   *  year (Salaries for a retired couple) hides itself. */
  alwaysShow?: boolean;
}

// Every row ties out: Total In − Total Out = Surplus / (Shortfall).
const CASH_FLOW_COLUMNS: MoneyColumn[] = [
  { key: "socialSecurity", header: "Social Security", group: "Cash In", value: (cf) => cf.socialSecurity },
  { key: "salaries", header: "Salaries", group: "Cash In", value: (cf) => cf.salaries },
  {
    key: "otherIncome",
    header: "Other Income",
    group: "Cash In",
    tooltip: "Pensions, business and trust income, annuities, note payments, and sale proceeds.",
    value: (cf) => cf.otherIncome,
  },
  { key: "rmds", header: "RMDs", group: "Cash In", value: (cf) => cf.rmds },
  { key: "withdrawals", header: "Withdrawals", group: "Cash In", value: (cf) => cf.withdrawals },
  { key: "totalIn", header: "Total In", group: "Cash In", value: (cf) => cf.totalIn, alwaysShow: true },
  { key: "livingExpenses", header: "Living Expenses", group: "Cash Out", value: (cf) => cf.living },
  { key: "taxes", header: "Taxes", group: "Cash Out", value: (cf) => cf.taxes },
  {
    key: "otherExpenses",
    header: "Other Expenses",
    group: "Cash Out",
    tooltip: "Debt payments, insurance premiums, property tax, gifts, and any other planned expenses.",
    value: (cf) => cf.otherExpenses,
  },
  { key: "savings", header: "Savings", group: "Cash Out", value: (cf) => cf.savings },
  { key: "totalOut", header: "Total Out", group: "Cash Out", value: (cf) => cf.totalOut, alwaysShow: true },
  {
    key: "net",
    header: "Surplus / (Shortfall)",
    tooltip: "Total In minus Total Out. A surplus stays in the portfolio; a shortfall is spending nothing could cover.",
    value: (cf) => cf.net,
    tone: (cf) => (isMaterialShortfall(-cf.net) ? "crit" : "default"),
    alwaysShow: true,
  },
];

export function retirementYearColumns(
  years: ProjectionYear[],
  hasSpouse: boolean,
  clientData: ClientData,
): YearTableColumn<ProjectionYear>[] {
  // Per-cell drill factory — resolves account/income/expense names against
  // the caller's working ClientData.
  const drill = (key: YearDrillColumnKey) => (row: ProjectionYear) =>
    buildYearCellDrill(key, row, clientData);
  const cf = (row: ProjectionYear) => yearCashFlow(row, clientData);

  const money = CASH_FLOW_COLUMNS.filter(
    (col) => col.alwaysShow || years.some((row) => Math.round(col.value(cf(row))) !== 0),
  ).map(
    ({ key, header, group, tooltip, value, tone }): YearTableColumn<ProjectionYear> => ({
      key,
      header,
      group,
      tooltip,
      align: "right",
      render: (row) => fmtAccounting(value(cf(row))),
      tone: tone && ((row) => tone(cf(row))),
      drill: drill(key),
    }),
  );

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
    ...money,
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

import type { YearTableColumn } from "@/components/scenario/year-table";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { buildYearCellDrill, type YearDrillColumnKey } from "@/lib/solver/year-cell-drill";
import { visibleCashFlowColumns, yearCashFlow } from "@/lib/solver/year-table-cash-flow";

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

  const money = visibleCashFlowColumns(years, clientData).map(
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

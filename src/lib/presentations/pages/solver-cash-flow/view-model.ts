// Solver Cash Flow view-model — the print form of the Solver's Cash Flow →
// Cash Flow report: the income stack against Total Out, over the Cash In /
// Cash Out table.
//
// Every figure comes from `yearCashFlow` and the column set from
// `visibleCashFlowColumns`, the same builders the on-screen table uses, so the
// printed sheet cannot drift from the screen the advisor solved on, and each
// row ties out the same way: Total In − Total Out = Surplus / (Shortfall).

import type { ClientData, ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import {
  visibleCashFlowColumns,
  yearCashFlow,
  type CashFlowColumn,
} from "@/lib/solver/year-table-cash-flow";
import { CASH_FLOW_INFLOW_COLORS } from "@/lib/solver/cashflow-year-detail";
import { dataLight } from "@/brand";
import { PRESENTATION_THEME } from "../../theme";
import type {
  DrillColumn,
  DrillPageData,
  DrillPageOptions,
  DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";

export const SOLVER_CASH_FLOW_TITLE = "Solver - Cash Flow";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

/** Two-line headers. Up to thirteen money columns share a portrait sheet, so a
 *  header that wraps on its own would wrap in a different place per column. */
const PRINT_HEADERS: Partial<Record<CashFlowColumn["key"], string>> = {
  socialSecurity: "Social\nSecurity",
  otherIncome: "Other\nIncome",
  withdrawals: "With-\ndrawals",
  totalIn: "Total\nIn",
  livingExpenses: "Living\nExpenses",
  otherExpenses: "Other\nExpenses",
  totalOut: "Total\nOut",
  // "(Shortfall)" is too wide for a thirteenth of the sheet and breaks onto a
  // third line; the red, parenthesized figures already say which is which.
  net: "Surplus /\nShortfall",
};

/** The income columns the chart stacks — the same five bars, in the same
 *  colors, as the on-screen Solver chart. Stacking the table's own values means
 *  each bar's top is that row's Total In. */
const CHART_STACK_COLORS: Partial<Record<CashFlowColumn["key"], string>> = {
  socialSecurity: dataLight[CASH_FLOW_INFLOW_COLORS.socialSecurity],
  salaries: dataLight[CASH_FLOW_INFLOW_COLORS.salaries],
  otherIncome: dataLight[CASH_FLOW_INFLOW_COLORS.otherInflows],
  rmds: dataLight[CASH_FLOW_INFLOW_COLORS.rmds],
  withdrawals: dataLight[CASH_FLOW_INFLOW_COLORS.withdrawals],
};

/** Whole dollars, like the screen: a break-even year's float residue (−$0.30)
 *  becomes 0, never a red "($0)" shortfall — nor −0. */
function wholeDollars(n: number): number {
  return Math.round(n) || 0;
}

export interface BuildSolverCashFlowInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildSolverCashFlowData(input: BuildSolverCashFlowInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;

  // Decided over the FULL projection, then clipped, so every range of one plan
  // prints the same columns.
  const moneyColumns = visibleCashFlowColumns(years, clientData);
  const visibleYears = filterYearsToRange(years, options.range as RangeOption);

  const columns: DrillColumn[] = [
    ...moneyColumns.map(
      (col): DrillColumn => ({
        key: col.key,
        header: PRINT_HEADERS[col.key] ?? col.header,
        width: 0, // only the right-pinned last column's width is honored
        strong: col.alwaysShow,
        // Red on a shortfall, like the screen.
        critWhenNegative: col.key === "net",
      }),
    ),
    {
      key: "portfolioAssets",
      header: "Portfolio\nAssets",
      width: 46,
      critWhenNegative: true,
    },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const cf = yearCashFlow(py, clientData);
    const cells: Record<string, number> = {
      portfolioAssets: wholeDollars(liquidPortfolioTotal(py)),
    };
    for (const col of moneyColumns) cells[col.key] = wholeDollars(col.value(cf));
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells,
    };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const chartSpec = buildDrillChartSpec({
    years: rows.map((r) => r.year),
    stacks: moneyColumns.flatMap((col) => {
      const color = CHART_STACK_COLORS[col.key];
      return color
        ? [{ seriesId: `cf:${col.key}`, label: col.header, color, values: rows.map((r) => r.cells[col.key]) }]
        : [];
    }),
    lines: [
      {
        seriesId: "totalOut",
        label: "Total Out",
        color: PRESENTATION_THEME.chartLine,
        values: rows.map((r) => r.cells.totalOut),
      },
    ],
    markers,
  });

  return {
    title: SOLVER_CASH_FLOW_TITLE,
    subtitle: scenarioLabel,
    callout: options.showCallout ? options.calloutText ?? undefined : undefined,
    chartSpec,
    table: { columns, rows, markers },
    footnote: DISCLAIMER,
  };
}

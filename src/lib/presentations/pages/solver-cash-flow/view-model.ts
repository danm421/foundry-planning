// Solver Cash Flow view-model — the print form of the Solver's Cash Flow tab:
// the income stack against Total Out, over one year's breakdown (Inflows,
// Portfolio Withdrawals, Outflows, then Net Cash Flow / Withdrawal % / Ending
// Portfolio).
//
// The breakdown comes from `buildCashFlowYearDetail` and the bottom line from
// `yearWithdrawalRate` / `yearQcd` — the builders the on-screen year panel
// renders — so the printed sheet shows the figures the advisor solved on.

import type { ClientData, ProjectionYear } from "@/engine/types";
import {
  buildCashFlowYearDetail,
  CASH_FLOW_INFLOW_COLORS,
  type CashFlowCategory,
  type CashFlowLineItem,
} from "@/lib/solver/cashflow-year-detail";
import { yearCashFlow, type YearCashFlow } from "@/lib/solver/year-table-cash-flow";
import { yearQcd, yearWithdrawalRate } from "@/lib/solver/withdrawal-report";
import { dataLight } from "@/brand";
import type { ChartSpec } from "../../charts/types";
import { PRESENTATION_THEME } from "../../theme";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import type { SolverCashFlowOptions } from "./options-schema";

export const SOLVER_CASH_FLOW_TITLE = "Solver - Cash Flow";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

/** Points a breakdown column takes on the sheet, measured from a render: the
 *  heading and total rows, a category row, each line item under it, and the gap
 *  between Total Inflows and the withdrawals beneath it. */
const PT = { head: 17, category: 17.7, item: 11.4, total: 17, gap: 10 };

const CHART_FRAME = { width: 526, height: 210, margin: { top: 20, right: 12, bottom: 50, left: 60 } };

/** Points the taller column may take on a sheet of its own — the sheet less
 *  the head, year row, bottom line, footnote and 10pt to spare — and under the
 *  chart. Past the first the line items give way and each category prints as
 *  its one total row; past the second the chart does. A breakdown that grew
 *  past the sheet would not break onto the next: react-pdf squeezes it over the
 *  footer (see PageFrame's `flow`). */
const PT_ON_OWN_SHEET = 486;
const PT_UNDER_CHART = PT_ON_OWN_SHEET - CHART_FRAME.height;

/** The chart's bars — the same five stacks, in the same colors, as the
 *  on-screen Solver chart, sized from `yearCashFlow` so they add up to Total
 *  In. (The screen sizes Other Inflows and RMDs its own way.) */
const CHART_STACKS: Array<{ key: keyof typeof CASH_FLOW_INFLOW_COLORS; label: string; value: (cf: YearCashFlow) => number }> = [
  { key: "socialSecurity", label: "Social Security", value: (cf) => cf.socialSecurity },
  { key: "salaries", label: "Salaries", value: (cf) => cf.salaries },
  { key: "otherInflows", label: "Other Inflows", value: (cf) => cf.otherIncome },
  { key: "rmds", label: "RMDs", value: (cf) => cf.rmds },
  { key: "withdrawals", label: "Withdrawals", value: (cf) => cf.withdrawals },
];

export interface BreakdownCategory {
  key: string;
  label: string;
  total: number;
  items: CashFlowLineItem[];
  /** The inflow's bar color; null for an outflow, which has no bar. */
  color: string | null;
}

export interface SolverCashFlowPageData {
  title: string;
  subtitle: string;
  /** Null when the projection has no years to show. */
  year: number | null;
  ageLabel: string;
  chartSpec: ChartSpec | null;
  inflows: BreakdownCategory[];
  withdrawals: BreakdownCategory | null;
  outflows: BreakdownCategory[];
  totals: { inflows: number; outflows: number; net: number; endingPortfolio: number };
  /** 0 hides the figure, as the screen does in a year nothing is drawn. */
  withdrawalRate: number;
  qcd: number;
  footnote: string;
}

export interface BuildSolverCashFlowInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: SolverCashFlowOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

/** The chosen year clamped into the projection, so a deck saved last year
 *  still prints. No year chosen → the first plan year. */
export function resolveSolverCashFlowYear(
  years: { year: number }[],
  year: number | null,
): number | null {
  if (years.length === 0) return null;
  const first = years[0].year;
  return year == null ? first : Math.min(Math.max(year, first), years[years.length - 1].year);
}

function toBreakdown(c: CashFlowCategory, keepItems: boolean): BreakdownCategory {
  const colorKey = CASH_FLOW_INFLOW_COLORS[c.key as keyof typeof CASH_FLOW_INFLOW_COLORS];
  return {
    key: c.key,
    label: c.label,
    total: c.total,
    items: keepItems ? c.items : [],
    color: colorKey ? dataLight[colorKey] : null,
  };
}

function blocksHeight(categories: CashFlowCategory[]): number {
  return categories.reduce((pt, c) => pt + PT.category + c.items.length * PT.item, 0);
}

export function buildSolverCashFlowData(input: BuildSolverCashFlowInput): SolverCashFlowPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const year = resolveSolverCashFlowYear(years, options.year);
  const py = years.find((y) => y.year === year);

  const empty: SolverCashFlowPageData = {
    title: SOLVER_CASH_FLOW_TITLE,
    subtitle: scenarioLabel,
    year: null,
    ageLabel: "",
    chartSpec: null,
    inflows: [],
    withdrawals: null,
    outflows: [],
    totals: { inflows: 0, outflows: 0, net: 0, endingPortfolio: 0 },
    withdrawalRate: 0,
    qcd: 0,
    footnote: DISCLAIMER,
  };
  if (!py) return empty;

  const detail = buildCashFlowYearDetail(py, clientData);
  // The taller of the two breakdown columns, with every line item printed.
  const height =
    PT.head +
    PT.total +
    Math.max(
      blocksHeight(detail.inflows) +
        (detail.withdrawals ? PT.gap + blocksHeight([detail.withdrawals]) : 0),
      blocksHeight(detail.outflows),
    );
  const keepItems = height <= PT_ON_OWN_SHEET;

  const flows = height <= PT_UNDER_CHART ? years.map((y) => yearCashFlow(y, clientData)) : null;
  const chartSpec = flows
    ? buildDrillChartSpec({
        years: years.map((y) => y.year),
        // A bar that is $0 in every year has no legend entry, like the screen.
        stacks: CHART_STACKS.filter((s) => flows.some((cf) => Math.round(s.value(cf)) !== 0)).map(
          (s) => ({
            seriesId: `cf:${s.key}`,
            label: s.label,
            color: dataLight[CASH_FLOW_INFLOW_COLORS[s.key]],
            values: flows.map((cf) => Math.round(s.value(cf))),
          }),
        ),
        lines: [
          {
            seriesId: "totalOut",
            label: "Total Out",
            color: PRESENTATION_THEME.chartLine,
            values: flows.map((cf) => Math.round(cf.totalOut)),
          },
        ],
        markers: buildMarkers(clientData, years, clientName, spouseName),
        highlightYear: py.year,
        frame: CHART_FRAME,
      })
    : null;

  return {
    ...empty,
    year: py.year,
    ageLabel: detail.ageLabel,
    chartSpec,
    inflows: detail.inflows.map((c) => toBreakdown(c, keepItems)),
    withdrawals: detail.withdrawals ? toBreakdown(detail.withdrawals, keepItems) : null,
    outflows: detail.outflows.map((c) => toBreakdown(c, keepItems)),
    totals: detail.totals,
    withdrawalRate: yearWithdrawalRate(py, years, clientData.accounts),
    qcd: yearQcd(py, clientData.accounts),
  };
}

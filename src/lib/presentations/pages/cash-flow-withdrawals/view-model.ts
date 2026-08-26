// Withdrawals drill-down view-model — the print form of the Solver's
// Cash Flow → Withdrawals report.
//
// It reads left to right as the year's cash story: what came in without
// touching the portfolio, what the portfolio had to cover and from which tax
// treatment, how hard that leaned on it, then what went out and what was left.
//
// SPLIT BY TAX TREATMENT, deliberately unlike the Net Cash Flow sheet, which
// splits the same dollars by ASSET CATEGORY. Two different conversations: this
// one is withdrawal sequencing (which bucket do we spend next, and what does it
// cost in tax), that one is which part of the balance sheet is funding the
// plan. Both are worth printing; neither replaces the other.
//
// Every figure comes from `buildWithdrawalReportRows`, the same builder the
// on-screen report uses, so the printed sheet cannot drift from the screen the
// advisor solved on.

import type { ClientData, ProjectionYear } from "@/engine/types";
import {
  activeWithdrawalSources,
  buildWithdrawalReportRows,
  type WithdrawalSourceKey,
} from "@/lib/solver/withdrawal-report";
import type { DataColorKey } from "@/brand";
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

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

/** Shares hues with the on-screen chart's `SOURCE_COLOR` so a draw source keeps
 *  one identity between the screen and the sheet handed to the client. */
const SOURCE_COLOR: Record<WithdrawalSourceKey, DataColorKey> = {
  cash: "teal",
  taxable: "yellow",
  preTax: "orange",
  roth: "green",
};

/** Two-line headers. The table is up to eleven columns wide, so a header that
 *  wraps on its own would wrap in a different place per column width. */
const HEADERS: Record<WithdrawalSourceKey, string> = {
  cash: "Cash",
  taxable: "Taxable",
  preTax: "Tax-\nDeferred",
  roth: "Roth",
};

export interface BuildWithdrawalsDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildWithdrawalsDrillData(
  input: BuildWithdrawalsDrillInput,
): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;

  // Built over the FULL projection, then clipped. Two reasons, and both would
  // be silent bugs the other way round: `liquidPortfolioBoy` reaches back to
  // the PRIOR year for its denominator, which a pre-filter would have thrown
  // away; and `activeWithdrawalSources` decides the column set, which has to
  // be the same for every range of one plan.
  const allRows = buildWithdrawalReportRows(years, clientData.accounts);
  const sources = activeWithdrawalSources(allRows);

  const visibleYears = filterYearsToRange(years, options.range as RangeOption);
  const visible = new Set(visibleYears.map((y) => y.year));
  const rowsInRange = allRows.filter((r) => visible.has(r.year));

  const columns: DrillColumn[] = [
    { key: "totalIncome", header: "Total\nIncome", width: 52 },
    ...sources.map(
      (s): DrillColumn => ({ key: `wd_${s.key}`, header: HEADERS[s.key], width: 44 }),
    ),
    { key: "withdrawalsTotal", header: "Total\nWithdrawals", width: 56, strong: true },
    { key: "portfolioBoy", header: "Portfolio\n(BoY)", width: 56 },
    { key: "withdrawalRate", header: "Withdrawal\n%", width: 50, format: "percent" },
    { key: "livingExpenses", header: "Living\nExpenses", width: 52 },
    { key: "totalExpenses", header: "Total\nExpenses", width: 52 },
    // The one column where the sign is the message: a negative year is the year
    // the portfolio had to close the gap.
    { key: "netCashFlow", header: "Net Cash\nFlow", width: 56, strong: true, signColor: true },
  ];

  const rows: DrillRow[] = rowsInRange.map((r) => {
    const cells: Record<string, number> = {
      totalIncome: r.totalIncome,
      withdrawalsTotal: r.withdrawalsTotal,
      portfolioBoy: r.portfolioBoy,
      withdrawalRate: r.withdrawalRate,
      livingExpenses: r.livingExpenses,
      totalExpenses: r.totalExpenses,
      netCashFlow: r.netCashFlow,
    };
    for (const s of sources) cells[`wd_${s.key}`] = r.withdrawals[s.key];
    return {
      year: r.year,
      ageClient: r.ages.client ?? null,
      ageSpouse: r.ages.spouse ?? null,
      cells,
    };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const chartSpec = buildDrillChartSpec({
    years: rowsInRange.map((r) => r.year),
    stacks: sources.map((s) => ({
      seriesId: `wd:${s.key}`,
      label: s.label,
      color: dataLight[SOURCE_COLOR[s.key]],
      values: rowsInRange.map((r) => r.withdrawals[s.key]),
    })),
    // The need the stack is answering. The gap between the line and the top of
    // the bars is what income covered without touching the portfolio.
    lines: [
      {
        seriesId: "livingExpenses",
        label: "Living Expenses",
        color: PRESENTATION_THEME.chartLine,
        values: rowsInRange.map((r) => r.livingExpenses),
      },
    ],
    markers,
  });

  return {
    title: "Withdrawals",
    subtitle: scenarioLabel,
    callout: options.showCallout ? options.calloutText ?? undefined : undefined,
    chartSpec,
    table: { columns, rows, markers },
    footnote: DISCLAIMER,
  };
}

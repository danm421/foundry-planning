// Monthly Cash Flow view-model — the print form of the Solver's
// Cash Flow → Monthly report.
//
// Every figure comes from `buildMonthlyCashFlowRows` / `buildMonthlyAllocation`,
// the same builders the screen uses, and the year the summary card captions
// comes from `selectMonthlyRow`, the screen's own rule. Restated here, all three
// would be free to drift — and an advisor who solved on screen would be handing
// the client a sheet that disagrees with it.

import type { ClientData, ProjectionYear } from "@/engine/types";
import {
  buildMonthlyCashFlowRows,
  selectMonthlyRow,
  type MonthlyCashFlowRow,
} from "@/lib/solver/monthly-cash-flow";
import { buildMonthlyAllocation } from "@/lib/solver/monthly-allocation";
import { exactCurrency } from "../../format";
import { dataLight } from "@/brand";
import { PRESENTATION_THEME } from "../../theme";
import type { ChartSpec } from "../../charts/types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import type { TableMarker } from "../../types";
import { buildDrillChartSpec, type DrillStackSeries } from "../../shared/build-chart-spec";
import type {
  MonthlyCashFlowPageData,
  MonthlyCashFlowPageOptions,
  MonthlyMonthRow,
  MonthlyPlanRow,
  MonthlySummary,
} from "./types";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

const CASH_ON_HAND_NOTE =
  "Cash on hand is a running cash-flow total, not an account balance — it opens at this household's liquid savings and carries each month's net forward. It ignores growth and treats a portfolio withdrawal as money in, so it shows whether a month is short, not what the accounts hold.";

const DEPLETED_NOTE =
  "A year marked † is one where the accounts are exhausted. The plan keeps spending against an overdrawn account, so that year's figure is money that does not exist.";

/** The glyph the table prints beside a depleted year. Shape and label, not
 *  colour alone — the flag has to survive a greyscale print. */
export const DEPLETED_GLYPH = "†";

/** Below a dollar a month the leftover is float dust that would print as "$0".
 *  Matches the on-screen panel's own floor. */
const UNEXPLAINED_FLOOR = 1;

/** See `monthChartSpec`. */
const MONTH_CHART_HEIGHT = 175;

export interface BuildMonthlyCashFlowInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: MonthlyCashFlowPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildMonthlyCashFlowPageData(
  input: BuildMonthlyCashFlowInput,
): MonthlyCashFlowPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;

  // Built over the FULL projection, never the visible range: `selectMonthlyRow`
  // falls back to the first SHORTFALL year, and a range that starts after it
  // would silently caption a different year than the screen does.
  const allRows = buildMonthlyCashFlowRows(years, clientData, options.basis);
  const selected = allRows.length > 0 ? selectMonthlyRow(allRows, options.year) : undefined;
  const summary = selected ? toSummary(selected) : null;

  const basisLabel = options.basis === "today" ? "Today's dollars" : "Future dollars";
  const base = {
    title: "Monthly Cash Flow",
    subtitle: `${scenarioLabel} · ${basisLabel}`,
    view: options.view,
    summary,
    footnote: DISCLAIMER,
  };

  if (options.view === "months") {
    const year = selected ? years.find((y) => y.year === selected.year) : undefined;
    const monthRows: MonthlyMonthRow[] = year
      ? buildMonthlyAllocation(year, clientData, options.basis).map((m) => ({
          label: m.label,
          income: m.income,
          portfolioDraw: m.portfolioDraw,
          taxes: m.taxes,
          debt: m.debt,
          savings: m.savings,
          other: m.other,
          living: m.living,
          net: m.net,
          cashOnHand: m.cashOnHand,
        }))
      : [];

    const notes = [CASH_ON_HAND_NOTE];
    // Only in the years it is true of. `net` subtracts a surplus-spending term
    // with no column of its own, so those rows genuinely do not add across —
    // but discretionary spend is zero on most plans, and an always-on note
    // would read as true of every year.
    if (summary && summary.surplusSpent > 0) {
      notes.push(
        `Each month in ${summary.year} the plan also spends ${exactCurrency(summary.surplusSpent)} of surplus. That comes out of Net without a column of its own, so these rows will not add across.`,
      );
    }
    if (summary?.depleted) notes.push(DEPLETED_NOTE);

    return {
      ...base,
      chartSpec: monthRows.length > 0 ? monthChartSpec(monthRows) : undefined,
      planRows: [],
      monthRows,
      notes,
    };
  }

  const visibleYears = filterYearsToRange(years, options.range as RangeOption);
  const visible = new Set(visibleYears.map((y) => y.year));
  const rowsInRange = allRows.filter((r) => visible.has(r.year));

  // The monthly rows carry only the prose age label; the numeric ages live on
  // the projection year the row was built from.
  const agesByYear = new Map(years.map((y) => [y.year, y.ages]));
  const planRows: MonthlyPlanRow[] = rowsInRange.map((r) => ({
    year: r.year,
    ageClient: agesByYear.get(r.year)?.client ?? null,
    ageSpouse: agesByYear.get(r.year)?.spouse ?? null,
    income: r.income,
    portfolioDraw: r.portfolioDraw,
    taxes: r.fixed.taxes,
    debt: r.fixed.liabilities,
    savings: r.fixed.savings,
    // Folded exactly as the on-screen table folds them, so the two agree column
    // for column.
    other: r.fixed.insurance + r.fixed.realEstate + r.fixed.other,
    available: r.available,
    depleted: r.depleted,
  }));

  const notes: string[] = [];
  // Keyed off the PRINTED rows, not the projection: a note about a year this
  // sheet does not show is a note about nothing.
  if (planRows.some((r) => r.depleted)) notes.push(DEPLETED_NOTE);

  return {
    ...base,
    chartSpec:
      planRows.length > 0
        ? planChartSpec(planRows, buildMarkers(clientData, visibleYears, clientName, spouseName))
        : undefined,
    planRows,
    monthRows: [],
    notes,
  };
}

function toSummary(r: MonthlyCashFlowRow): MonthlySummary {
  return {
    year: r.year,
    ageLabel: r.ageLabel,
    income: r.income,
    fixedTotal: r.fixed.total,
    leftAfterFixed: r.leftAfterFixed,
    portfolioDraw: r.portfolioDraw,
    available: r.available,
    living: r.split.living,
    surplusSpent: r.split.surplusSpent,
    surplusUnspent: r.split.surplusUnspent,
    // Below the floor it is float dust; zeroing it keeps a "$0" line off the
    // card without ever folding a real number into a neighbour.
    unexplained:
      Math.abs(r.split.unexplained) >= UNEXPLAINED_FLOOR ? r.split.unexplained : 0,
    depleted: r.depleted,
  };
}

/**
 * The bars total income + portfolio draw, so the visible gap between the income
 * line and the top of the stack IS the draw. That is the one thing this chart
 * has to communicate, and it holds by construction because the top band is the
 * residual rather than another category.
 */
function planChartSpec(rows: MonthlyPlanRow[], markers: TableMarker[]): ChartSpec {
  const stacks: DrillStackSeries[] = [
    stack("Taxes", rows.map((r) => r.taxes), dataLight.red),
    stack("Debt payments", rows.map((r) => r.debt), dataLight.orange),
    stack("Savings", rows.map((r) => r.savings), dataLight.blue),
    // The table's own fold, not a second copy of it: the chart band and the
    // "Other" column are the same number by construction.
    stack("Other fixed", rows.map((r) => r.other), dataLight.grey),
    // Split in two rather than stained per-point: the spec carries one colour
    // per series, and a legend entry naming the condition says out loud what a
    // colour alone only implies.
    stack(
      "Available",
      rows.map((r) => (r.depleted ? 0 : r.available)),
      dataLight.green,
    ),
  ];
  if (rows.some((r) => r.depleted)) {
    stacks.push(
      stack(
        // Nine characters, and that is a constraint not a preference: the sixth
        // legend slot has ~37pt before the canvas edge, so a longer label is
        // silently clipped mid-word (the deck's own Cash Flow sheet has printed
        // "Total Exper" for as long as it has existed). The full sentence lives
        // in the note under the table, where there is room for it.
        "Overdrawn",
        rows.map((r) => (r.depleted ? r.available : 0)),
        // NOT the critical red the on-screen chart stains with. That chart can
        // afford it because it outlines the band as well; this one cannot draw
        // a per-series border, and crit #b91c1c against the Taxes band's
        // #c5392b is 7.6 ΔE76 — two large flat patches that read as one colour,
        // which is the collision `solver-monthly-cash-flow-chart.tsx` documents.
        // Pink is unused in this chart and unmistakable against both; the
        // MEANING is carried by the legend's own words, the table's glyph and
        // the card's banner, never by the hue.
        dataLight.pink,
      ),
    );
  }

  return buildDrillChartSpec({
    years: rows.map((r) => r.year),
    stacks,
    lines: [
      {
        seriesId: "income",
        label: "Income",
        color: PRESENTATION_THEME.chartLine,
        values: rows.map((r) => r.income),
      },
    ],
    markers,
  });
}

/**
 * The same visual grammar on twelve months — the view changes the period, not
 * the way the chart is read. The top band is again the residual, so the gap to
 * the income line is still the draw; "Living", which the plan chart folds inside
 * Available, breaks out here and takes a hue no other band uses.
 */
function monthChartSpec(rows: MonthlyMonthRow[]): ChartSpec {
  const leftOver = (m: MonthlyMonthRow) =>
    m.income + m.portfolioDraw - m.taxes - m.debt - m.savings - m.other - m.living;

  const months = rows.map((_, i) => i + 1);
  const spec = buildDrillChartSpec({
    years: months,
    stacks: [
      stack("Taxes", rows.map((m) => m.taxes), dataLight.red),
      stack("Debt", rows.map((m) => m.debt), dataLight.orange),
      stack("Savings", rows.map((m) => m.savings), dataLight.blue),
      stack("Other", rows.map((m) => m.other), dataLight.grey),
      stack("Living", rows.map((m) => m.living), dataLight.purple),
      // A short month is the only band drawn below the zero line, and position
      // survives greyscale and colour-blindness alike.
      stack("Left over", rows.map(leftOver), dataLight.green),
    ],
    lines: [
      {
        seriesId: "income",
        label: "Income",
        color: PRESENTATION_THEME.chartLine,
        values: rows.map((m) => m.income),
      },
    ],
    markers: [],
  });

  // The x-axis is months, not years. `buildDrillChartSpec` thins ticks for a
  // multi-decade span; twelve of them all fit, and an unlabelled month is a
  // month the advisor has to count to.
  return {
    ...spec,
    // Shorter than the shared default, and the reason is a measurement: at the
    // 260pt every other Cash Flow sheet uses, the summary card plus the chart
    // pushed November and December onto a second sheet. Twelve months split
    // across two pages is a worse handout than a shorter chart — and unlike the
    // plan table, which genuinely runs to forty rows, this one has a fixed
    // twelve and can be made to fit. Verified by rendering, not by arithmetic.
    height: MONTH_CHART_HEIGHT,
    xAxis: {
      ...spec.xAxis,
      ticks: months,
      // Derived from the rows, never from a month-name constant: a constant
      // is a second source of truth that labels every bar wrong the moment the
      // row count is not twelve. Same rule as the on-screen chart.
      labelFormat: (v: number) => rows[v - 1]?.label.slice(0, 3) ?? String(v),
    },
  };
}

function stack(label: string, values: number[], color: string): DrillStackSeries {
  return { seriesId: label.toLowerCase().replace(/\s+/g, "-"), label, color, values };
}

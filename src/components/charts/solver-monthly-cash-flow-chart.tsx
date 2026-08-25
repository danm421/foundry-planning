"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { colors, colorsLight, data as brandData, dataLight as brandDataLight } from "@/brand";
import type { MonthlyCashFlowRow } from "@/lib/solver/monthly-cash-flow";
import type { MonthRow } from "@/lib/solver/monthly-allocation";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

const fmtCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const fmtFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** One constant, read by the dataset AND the tooltip, so renaming the band can
 *  never leave the depletion note attached to the wrong row. */
const AVAILABLE_LABEL = "Available";

/** What a depleted year's Available figure actually means, in the words an
 *  advisor would use across the table. The stain alone is not enough — color
 *  must never be the only thing carrying a meaning this severe. */
const DEPLETED_NOTE = "the portfolio has run out; this money is not there";

/** The depletion flag's SECOND carrier: a depleted year's Available segment is
 *  the only segment in the chart that is outlined.
 *
 *  The stain cannot carry it alone. In light theme `crit` #b91c1c sits 7.6 ΔE76
 *  from the ordinary Taxes band #c5392b — this chart's tightest INTENTIONAL
 *  pair is 25.5 — so two large flat patches of red read as one; and hue carries
 *  nothing at all for a color-blind reader, in either theme. What survives both
 *  is an outline where no other segment has one.
 *
 *  The stroke is `chartChrome().title`, the chart's single non-series ink (the
 *  Income line and the selected-year outline already use it). A third stroke
 *  hue would duplicate a series color or leave the palette, and the carrier is
 *  the outline's PRESENCE, not its hue. Selection and depletion stay legible
 *  apart by SCOPE: selection outlines the whole column, depletion one band. */
const DEPLETED_BORDER_WIDTH = 2;

/** The selected year's outline, matching `SolverCashFlowChart`. */
const SELECTED_BORDER_WIDTH = 2;

interface MonthlyDataset {
  type: "bar" | "line";
  label: string;
  data: number[];
  /** An ARRAY on the Available band — one color per year, so a depleted year
   *  stains without touching its neighbours. A flat string everywhere else. */
  backgroundColor?: string | string[];
  borderColor?: string;
  /** An ARRAY on the Available band — one width per year, so only a depleted
   *  year is outlined. A flat number on the Income line, absent elsewhere. */
  borderWidth?: number | number[];
  borderSkipped?: boolean;
  stack?: string;
  fill?: boolean;
  pointRadius?: number;
  tension?: number;
  order?: number;
}

/**
 * The income line, built once for both builders. Restated in each, it would be
 * free to drift — and the whole promise of the toggle is that it changes the
 * period, not the way the chart is read. `order: 0` against the bars' `1` keeps
 * it drawn over the stack.
 */
const incomeLine = (values: number[], ink: string): MonthlyDataset => ({
  type: "line",
  label: "Income",
  data: values,
  borderColor: ink,
  backgroundColor: "transparent",
  borderWidth: 2,
  pointRadius: 0,
  tension: 0.3,
  fill: false,
  order: 0,
});

/**
 * Pure dataset builder. The bars stack to income + portfolio draw, and the
 * Income line is drawn at income alone — so the visible gap between the line
 * and the top of the bar IS the draw. That is the one thing this chart has to
 * communicate: money is coming out of the portfolio to fund the lifestyle.
 *
 * Depleted years stain the Available band with the critical status color. Only
 * that band: the engine really did pay the taxes and the mortgage, it just paid
 * them by overdrafting, so restating the whole stack as unreal would overstate
 * what happened. Built as a per-point color array rather than a Chart.js
 * scriptable option so the flag is provable here, with nothing rendered.
 */
export function buildMonthlyCashFlowChartData(
  rows: MonthlyCashFlowRow[],
  theme: "dark" | "light" = "dark",
): { labels: string[]; datasets: MonthlyDataset[] } {
  const c = theme === "light" ? colorsLight : colors;
  const palette = theme === "light" ? brandDataLight : brandData;
  const chrome = chartChrome(theme);

  const bar = (
    label: string,
    pick: (r: MonthlyCashFlowRow) => number,
    color: string | string[],
  ): MonthlyDataset => ({
    type: "bar",
    label,
    data: rows.map(pick),
    backgroundColor: color,
    stack: "monthly",
    order: 1,
  });

  return {
    labels: rows.map((r) => String(r.year)),
    datasets: [
      bar("Taxes", (r) => r.fixed.taxes, palette.red),
      bar("Debt payments", (r) => r.fixed.liabilities, palette.orange),
      bar("Savings", (r) => r.fixed.savings, palette.blue),
      bar(
        "Other fixed",
        (r) => r.fixed.insurance + r.fixed.realEstate + r.fixed.other,
        palette.grey,
      ),
      {
        ...bar(
          AVAILABLE_LABEL,
          (r) => r.available,
          rows.map((r) => (r.depleted ? c.crit : palette.green)),
        ),
        borderColor: chrome.title,
        borderWidth: rows.map((r) => (r.depleted ? DEPLETED_BORDER_WIDTH : 0)),
        // All four sides, not the three Chart.js skips by default, so the
        // depleted segment reads as boxed off from the stack it sits on.
        borderSkipped: false,
      },
      incomeLine(
        rows.map((r) => r.income),
        c.ink,
      ),
    ],
  };
}

/** What the month has left once every band below it is paid: income plus the
 *  draw, minus the five committed categories. Identical to `net + surplusSpent`
 *  — `net` alone would leave the stack short by a surplus the chart has no band
 *  for, and the gap to the income line would stop being the draw. Not called
 *  "Net" for that reason: the two differ in exactly the years the panel's
 *  surplus note is on screen. */
const leftOver = (r: MonthRow) =>
  r.income + r.portfolioDraw - r.taxes - r.debt - r.savings - r.other - r.living;

/**
 * The same visual grammar as the across-the-plan chart — a stack of committed
 * costs with the income line drawn over it — on the twelve months of one year.
 * Keeping the grammar identical is the point: the toggle changes the period,
 * not the way the chart is read.
 *
 * Which means the stack has to reconcile the same way. The bars total
 * `income + portfolioDraw`, so the visible gap between the line and the top of
 * the stack IS the draw, exactly as it is above — and that holds by
 * construction, because the top band is the residual rather than another
 * category. A stack of costs alone would top out at `income + draw − net −
 * surplusSpent` and the gap would mean nothing.
 *
 * Colours carry over per category, so no band an advisor has learned to read is
 * re-coloured by the toggle. Green stays with the residual (Available's
 * counterpart); Living, which the year chart folds inside Available and this one
 * breaks out, takes a hue no band here uses.
 */
export function buildMonthAllocationChartData(
  rows: MonthRow[],
  theme: "dark" | "light" = "dark",
): { labels: string[]; datasets: MonthlyDataset[] } {
  const c = theme === "light" ? colorsLight : colors;
  const palette = theme === "light" ? brandDataLight : brandData;

  const bar = (
    label: string,
    pick: (r: MonthRow) => number,
    color: string | string[],
  ): MonthlyDataset => ({
    type: "bar",
    label,
    data: rows.map(pick),
    backgroundColor: color,
    stack: "monthly",
    order: 1,
  });

  return {
    // Derived from the rows, never from a month-name constant: a constant is a
    // second source of truth that points every bar at the wrong month the
    // moment the row count is not twelve.
    labels: rows.map((r) => r.label.slice(0, 3)),
    datasets: [
      bar("Taxes", (r) => r.taxes, palette.red),
      bar("Debt", (r) => r.debt, palette.orange),
      bar("Savings", (r) => r.savings, palette.blue),
      bar("Other", (r) => r.other, palette.grey),
      bar("Living", (r) => r.living, palette.purple),
      // Stained where the month is short — the moment this whole view exists to
      // find. Colour is not the only carrier: a negative band is the only band
      // in the chart drawn below the zero line, and position survives greyscale
      // and colour-blindness alike. Built as a per-point array rather than a
      // Chart.js scriptable option so the flag is provable with nothing
      // rendered, matching the depletion stain above.
      bar(
        "Left over",
        leftOver,
        rows.map((r) => (leftOver(r) < 0 ? c.crit : palette.green)),
      ),
      incomeLine(
        rows.map((r) => r.income),
        c.ink,
      ),
    ],
  };
}

/**
 * The three helpers below exist because `rows` is a PLAN-YEAR array indexed by
 * the chart's category index — which in month view is 0-11 for January through
 * December. Left inline, each one silently names an unrelated plan year: a click
 * on March would jump the panel to the third year of the plan, the selection
 * outline would land on an arbitrary month, and a depleted year at index 1 would
 * print "the portfolio has run out" on February. In month view they all go
 * inert. Nothing is lost — the panel's summary card renders the year's depletion
 * banner in words in both views, and the month chart is a detail of the year
 * that is already selected.
 */

/** The plan year a click at this category index selects, or null for none. */
export function clickedYear(
  rows: MonthlyCashFlowRow[],
  index: number,
  monthMode: boolean,
): number | null {
  if (monthMode) return null;
  return rows[index]?.year ?? null;
}

/** Which column the selection outline goes on; -1 for none. */
export function selectedYearIndex(
  rows: MonthlyCashFlowRow[],
  selectedYear: number | null | undefined,
  monthMode: boolean,
): number {
  if (monthMode || selectedYear == null) return -1;
  return rows.findIndex((r) => r.year === selectedYear);
}

/** Whether the hovered category's year has run out of money. */
export function depletedAt(
  rows: MonthlyCashFlowRow[],
  index: number,
  monthMode: boolean,
): boolean {
  return monthMode ? false : (rows[index]?.depleted ?? false);
}

/**
 * One tooltip row. A depleted year says so in words on the Available row —
 * the stain is the glance, this is the answer.
 *
 * The "/mo" suffix belongs to the across-the-plan view ONLY, where every figure
 * is a year's total spread over twelve. In month view the figure is what lands
 * IN that month, and a November property-tax bill hovering as "$12,000/mo"
 * would name a rate the household never pays.
 */
export function monthlyCashFlowTooltipLabel(
  datasetLabel: string,
  value: number,
  depleted: boolean,
  /** REQUIRED, deliberately not defaulted: a caller that forgets it is a type
   *  error rather than a tooltip that quietly names a rate the household never
   *  pays. Measured — with a default, dropping it at the call site left all 28
   *  tests green. */
  monthMode: boolean,
): string {
  const base = `${datasetLabel}: ${fmtFull.format(value)}${monthMode ? "" : "/mo"}`;
  return depleted && datasetLabel === AVAILABLE_LABEL ? `${base} — ${DEPLETED_NOTE}` : base;
}

/**
 * Outline the selected year rather than dimming the rest, so the whole
 * projection stays readable. Mirrors `SolverCashFlowChart`.
 *
 * COMPOSES with the border the builder already wrote — it does not overwrite
 * it. Writing a selection-only width across the chart would zero the depletion
 * outline on every year that is not the selected one, silently un-flagging the
 * chart's one hard warning the moment an advisor clicks a different year. A
 * depleted year that IS the selected year gets one stroke for both reasons and
 * still reads as depleted through its stain and its tooltip.
 */
export function applySelectedYearOutline(
  data: { labels: string[]; datasets: MonthlyDataset[] },
  selectedIndex: number,
  outlineColor: string,
): { labels: string[]; datasets: MonthlyDataset[] } {
  if (selectedIndex < 0) return data;
  return {
    ...data,
    datasets: data.datasets.map((ds) => {
      if (ds.type !== "bar") return ds;
      const own = ds.borderWidth;
      return {
        ...ds,
        borderColor: ds.borderColor ?? outlineColor,
        borderWidth: data.labels.map((_, i) =>
          Math.max(
            (Array.isArray(own) ? own[i] : own) ?? 0,
            i === selectedIndex ? SELECTED_BORDER_WIDTH : 0,
          ),
        ),
        borderSkipped: false,
      };
    }),
  };
}

interface Props {
  rows: MonthlyCashFlowRow[];
  onYearClick?: (year: number) => void;
  selectedYear?: number | null;
  /** The selected year split into twelve months, drawn when `view` is "months". */
  monthRows?: MonthRow[];
  /** Defaults to the chart this component has always drawn, so a caller that
   *  forgets the toggle degrades to today's behaviour. */
  view?: "plan" | "months";
}

export function SolverMonthlyCashFlowChart({
  rows,
  onYearClick,
  selectedYear,
  monthRows = [],
  view = "plan",
}: Props) {
  const theme = useThemeName();
  const monthMode = view === "months";
  const data = useMemo(
    () =>
      monthMode
        ? buildMonthAllocationChartData(monthRows, theme)
        : buildMonthlyCashFlowChartData(rows, theme),
    [monthMode, monthRows, rows, theme],
  );
  const chrome = chartChrome(theme);

  const selectedIndex = useMemo(
    () => selectedYearIndex(rows, selectedYear, monthMode),
    [rows, selectedYear, monthMode],
  );

  const styledData = useMemo(
    () => applySelectedYearOutline(data, selectedIndex, chrome.title),
    [data, selectedIndex, chrome.title],
  );

  return (
    <Chart
      type="bar"
      data={styledData}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        onClick: (_event, elements: Array<{ index: number }>) => {
          if (!onYearClick || elements.length === 0) return;
          const year = clickedYear(rows, elements[0].index, monthMode);
          if (year != null) onYearClick(year);
        },
        scales: {
          x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
          y: {
            stacked: true,
            ticks: { color: chrome.tick, callback: (v) => fmtCompact.format(Number(v)) },
            grid: { color: chrome.grid },
          },
        },
        plugins: {
          legend: { labels: { color: chrome.legend } },
          tooltip: {
            backgroundColor: chrome.tooltipBg,
            titleColor: chrome.tooltipTitle,
            bodyColor: chrome.tooltipBody,
            // Drop rows that are exactly $0 for the hovered year, so the tooltip
            // lists only what is actually flowing. Mirrors SolverCashFlowChart.
            filter: (item) => Number(item.parsed.y) !== 0,
            callbacks: {
              label: (ctx) =>
                monthlyCashFlowTooltipLabel(
                  ctx.dataset.label ?? "",
                  Number(ctx.parsed.y),
                  depletedAt(rows, ctx.dataIndex, monthMode),
                  monthMode,
                ),
            },
          },
        },
      }}
    />
  );
}

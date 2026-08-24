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
      {
        type: "line",
        label: "Income",
        data: rows.map((r) => r.income),
        borderColor: c.ink,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
        order: 0,
      },
    ],
  };
}

/**
 * One tooltip row. A depleted year says so in words on the Available row —
 * the stain is the glance, this is the answer.
 */
export function monthlyCashFlowTooltipLabel(
  datasetLabel: string,
  value: number,
  depleted: boolean,
): string {
  const base = `${datasetLabel}: ${fmtFull.format(value)}/mo`;
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
}

export function SolverMonthlyCashFlowChart({ rows, onYearClick, selectedYear }: Props) {
  const theme = useThemeName();
  const data = useMemo(() => buildMonthlyCashFlowChartData(rows, theme), [rows, theme]);
  const chrome = chartChrome(theme);

  const selectedIndex = useMemo(
    () => (selectedYear == null ? -1 : rows.findIndex((r) => r.year === selectedYear)),
    [rows, selectedYear],
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
          const year = rows[elements[0].index]?.year;
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
                  rows[ctx.dataIndex]?.depleted ?? false,
                ),
            },
          },
        },
      }}
    />
  );
}

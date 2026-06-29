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
import type { ProjectionYear } from "@/engine";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { colors, colorsLight, data as brandData, dataLight as brandDataLight } from "@/brand";

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

interface CashFlowDataset {
  type: "bar" | "line";
  label: string;
  data: number[];
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  stack?: string;
  fill?: boolean;
  pointRadius?: number;
  tension?: number;
  order?: number;
}

/**
 * Pure dataset builder for the solver Cash Flow chart. Mirrors the main
 * cash-flow report (`cashflow-report.tsx`): five stacked income bars plus a
 * Total Expenses line. If the report's income segments change, update this
 * in tandem.
 *
 * Colors are resolved once against the supplied theme so the returned datasets
 * are theme-stable; callers that need live theme-switching should use
 * `SolverCashFlowChart` (which calls `useThemeName` reactively).
 */
export function buildSolverCashFlowChartData(
  years: ProjectionYear[],
  theme: "dark" | "light" = "dark",
): {
  labels: string[];
  datasets: CashFlowDataset[];
} {
  const otherIncome = (y: ProjectionYear) =>
    y.income.business +
    y.income.deferred +
    y.income.capitalGains +
    y.income.trust +
    y.income.other;
  const rmd = (y: ProjectionYear) =>
    Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);

  const c = theme === "light" ? colorsLight : colors;
  const palette = theme === "light" ? brandDataLight : brandData;
  // Expenses line sits on top of bars — use ink color for high contrast
  const expensesLine = c.ink;

  return {
    labels: years.map((y) => String(y.year)),
    datasets: [
      {
        type: "bar",
        label: "Social Security",
        data: years.map((y) => y.income.socialSecurity),
        backgroundColor: palette.blue,
        stack: "inflows",
        order: 1,
      },
      {
        type: "bar",
        label: "Salaries",
        data: years.map((y) => y.income.salaries),
        backgroundColor: palette.green,
        stack: "inflows",
        order: 1,
      },
      {
        type: "bar",
        label: "Other Inflows",
        data: years.map(otherIncome),
        backgroundColor: palette.teal,
        stack: "inflows",
        order: 1,
      },
      {
        type: "bar",
        label: "RMDs",
        data: years.map(rmd),
        backgroundColor: palette.orange,
        stack: "inflows",
        order: 1,
      },
      {
        type: "bar",
        label: "Withdrawals",
        data: years.map((y) => y.withdrawals.total),
        backgroundColor: palette.yellow,
        stack: "inflows",
        order: 1,
      },
      {
        type: "line",
        label: "Total Expenses",
        data: years.map((y) => y.totalExpenses),
        borderColor: expensesLine,
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

interface Props {
  years: ProjectionYear[];
}

export function SolverCashFlowChart({ years }: Props) {
  const theme = useThemeName();

  const data = useMemo(
    () => buildSolverCashFlowChartData(years, theme),
    [years, theme],
  );

  const chrome = chartChrome(theme);

  return (
    <Chart
      type="bar"
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
          y: {
            stacked: true,
            ticks: {
              color: chrome.tick,
              callback: (v) => fmtCompact.format(Number(v)),
            },
            grid: { color: chrome.grid },
          },
        },
        plugins: {
          legend: { labels: { color: chrome.legend } },
          tooltip: {
            backgroundColor: chrome.tooltipBg,
            titleColor: chrome.tooltipTitle,
            bodyColor: chrome.tooltipBody,
            // Drop income rows that are exactly $0 for the hovered year, so the
            // tooltip only lists what's actually flowing (e.g. no "Salaries: $0"
            // once retired). `filter` removes the whole row including its color
            // swatch — cleaner than blanking the label. Total Expenses isn't
            // zero in practice, so it always stays.
            filter: (item) => Number(item.parsed.y) !== 0,
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${fmtFull.format(Number(ctx.parsed.y))}`,
            },
          },
        },
      }}
    />
  );
}

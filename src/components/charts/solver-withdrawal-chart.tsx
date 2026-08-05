"use client";

import { memo, useMemo } from "react";
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
import type { DataColorKey } from "@/brand";
import {
  activeWithdrawalSources,
  type WithdrawalReportRow,
  type WithdrawalSourceKey,
} from "@/lib/solver/withdrawal-report";

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

// Shares cash/taxable/retirement hues with the cash-flow report's "Withdrawals
// by category" chart so a draw source keeps one identity across reports; Roth
// takes green, the next unused anchor.
const SOURCE_COLOR: Record<WithdrawalSourceKey, DataColorKey> = {
  cash: "teal",
  taxable: "yellow",
  preTax: "orange",
  roth: "green",
};

interface WithdrawalChartDataset {
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
 * Pure dataset builder for the solver Withdrawals chart. Same bars-plus-line shape as
 * `buildSolverCashFlowChartData`, narrowed to the portfolio draw: the stack is
 * the year's withdrawals split by where they came from, and the line is the
 * living expense they help cover. The gap between the stack and the line is what
 * income, Social Security, and RMDs paid for.
 *
 * Sources with no draw anywhere in the projection are dropped rather than
 * rendered as a flat zero band, so the legend only names what's in play.
 */
export function buildSolverWithdrawalChartData(
  rows: WithdrawalReportRow[],
  theme: "dark" | "light" = "dark",
): {
  labels: string[];
  datasets: WithdrawalChartDataset[];
} {
  const c = theme === "light" ? colorsLight : colors;
  const palette = theme === "light" ? brandDataLight : brandData;

  return {
    labels: rows.map((r) => String(r.year)),
    datasets: [
      ...activeWithdrawalSources(rows).map((source) => ({
        type: "bar" as const,
        label: source.label,
        data: rows.map((r) => r.withdrawals[source.key]),
        backgroundColor: palette[SOURCE_COLOR[source.key]],
        stack: "withdrawals",
        order: 1,
      })),
      {
        type: "line",
        label: "Living Expenses",
        data: rows.map((r) => r.livingExpenses),
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

interface Props {
  rows: WithdrawalReportRow[];
  onYearClick?: (year: number) => void;
  selectedYear?: number | null;
}

// Memoized for the same reason as SolverWithdrawalPanel: this sub-tab keeps its
// content mounted, and the chart-height drag re-renders the parent per
// pointermove. Chart.js resizes itself off the wrapper, so it needs no help
// from React to follow the drag.
export const SolverWithdrawalChart = memo(function SolverWithdrawalChart({
  rows,
  onYearClick,
  selectedYear,
}: Props) {
  const theme = useThemeName();

  const data = useMemo(() => buildSolverWithdrawalChartData(rows, theme), [rows, theme]);

  const chrome = chartChrome(theme);

  // Outline the selected year rather than dimming the rest — same treatment as
  // the Cash Flow chart, so switching sub-tabs keeps the selection legible.
  const selectedIndex = useMemo(
    () => (selectedYear == null ? -1 : rows.findIndex((r) => r.year === selectedYear)),
    [rows, selectedYear],
  );
  const styledData = useMemo(() => {
    if (selectedIndex < 0) return data;
    return {
      ...data,
      datasets: data.datasets.map((ds) =>
        ds.type !== "bar"
          ? ds
          : {
              ...ds,
              borderColor: chrome.title,
              borderWidth: (ctx: { dataIndex: number }) =>
                ctx.dataIndex === selectedIndex ? 2 : 0,
              borderSkipped: false,
            },
      ),
    };
  }, [data, selectedIndex, chrome.title]);

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
            // Same rule as the Cash Flow chart: drop $0 rows so the tooltip
            // lists only the sources actually drawn on in the hovered year.
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
});

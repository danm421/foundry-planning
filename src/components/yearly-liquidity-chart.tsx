"use client";

import { useMemo } from "react";
import type { Ref } from "react";
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
import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
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

interface Props {
  rows: YearlyLiquidityReport["rows"];
  showPortfolio: boolean;
  /** Set by the view to grab a PNG of the canvas for the PDF export. */
  chartRef?: Ref<ChartJS<"bar" | "line"> | undefined>;
  /**
   * Wrapper sizing. Defaults to the report view's fixed height; the solver
   * panel passes `h-full w-full` so the chart fills its resizable container.
   */
  className?: string;
}

export function YearlyLiquidityChart({
  rows,
  showPortfolio,
  chartRef,
  className = "h-72 w-full",
}: Props) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    const labels = rows.map((r) => String(r.year));
    const portfolio = rows.map((r) => r.totalPortfolioAssets);
    const insIn = rows.map((r) => r.insuranceInEstate);
    const insOut = rows.map((r) => r.insuranceOutOfEstate);
    const transfer = rows.map((r) => r.totalTransferCost);

    const c = theme === "light" ? colorsLight : colors;
    const palette = theme === "light" ? brandDataLight : brandData;

    const datasets: ({
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
      // Chart.js draws lower-order datasets later, so they appear on top.
      order?: number;
    })[] = [];

    // Bar segments share order: 1 (drawn first, appear behind).
    // Stack order (bottom → top): insurance segments, then portfolio assets.
    datasets.push(
      {
        type: "bar",
        label: "Insurance In Estate",
        data: insIn,
        backgroundColor: palette.green,
        stack: "stack",
        order: 1,
      },
      {
        type: "bar",
        label: "Insurance Out Of Estate",
        data: insOut,
        backgroundColor: c.good,
        stack: "stack",
        order: 1,
      },
    );
    if (showPortfolio) {
      datasets.push({
        type: "bar",
        label: "Total Portfolio Assets",
        data: portfolio,
        backgroundColor: palette.blue,
        stack: "stack",
        order: 1,
      });
    }
    datasets.push({
      type: "line",
      label: "Total Transfer Cost",
      data: transfer,
      borderColor: palette.red,
      backgroundColor: palette.red,
      borderWidth: 4,
      pointRadius: 3,
      tension: 0,
      fill: false,
      // Lower order than the bars → drawn last → on top.
      order: 0,
    });

    return { labels, datasets };
  }, [rows, showPortfolio, theme]);

  const chrome = chartChrome(theme);

  return (
    <div className={className}>
      <Chart
        ref={chartRef}
        type="bar"
        data={chartData}
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
              callbacks: {
                label: (ctx) =>
                  `${ctx.dataset.label}: ${fmtFull.format(Number(ctx.parsed.y))}`,
              },
            },
          },
        }}
      />
    </div>
  );
}

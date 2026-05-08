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
  chartRef?: Ref<ChartJS<"bar" | "line">>;
}

export function YearlyLiquidityChart({ rows, showPortfolio, chartRef }: Props) {
  const data = useMemo(() => {
    const labels = rows.map((r) => String(r.year));
    const portfolio = rows.map((r) => r.totalPortfolioAssets);
    const insIn = rows.map((r) => r.insuranceInEstate);
    const insOut = rows.map((r) => r.insuranceOutOfEstate);
    const transfer = rows.map((r) => r.totalTransferCost);

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
    })[] = [];

    if (showPortfolio) {
      datasets.push({
        type: "bar",
        label: "Total Portfolio Assets",
        data: portfolio,
        backgroundColor: "#3b82f6",
        stack: "stack",
      });
    }
    datasets.push(
      {
        type: "bar",
        label: "Insurance In Estate",
        data: insIn,
        backgroundColor: "#14b8a6",
        stack: "stack",
      },
      {
        type: "bar",
        label: "Insurance Out Of Estate",
        data: insOut,
        backgroundColor: "#22c55e",
        stack: "stack",
      },
      {
        type: "line",
        label: "Total Transfer Cost",
        data: transfer,
        borderColor: "#ef4444",
        backgroundColor: "#ef4444",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        fill: false,
      },
    );

    return { labels, datasets };
  }, [rows, showPortfolio]);

  return (
    <div className="h-72 w-full">
      <Chart
        ref={chartRef}
        type="bar"
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          scales: {
            x: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
            y: {
              stacked: true,
              ticks: {
                color: "#9ca3af",
                callback: (v) => fmtCompact.format(Number(v)),
              },
              grid: { color: "#1f2937" },
            },
          },
          plugins: {
            legend: { labels: { color: "#e5e7eb" } },
            tooltip: {
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

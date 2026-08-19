"use client";
import type { ReactElement } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { useThemeName, chartChrome, dataPalette } from "@/lib/chart-colors";
import { fmtUsd } from "@/lib/portal/format";
import {
  monthLabel,
  paydownChartIsEmpty,
  paydownChartPoints,
  type PaydownComparison,
} from "@/lib/calculators/debt-paydown";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

/**
 * What they owe over time: doing nothing against the plan.
 *
 * One point per month — a 30-year mortgage is 360 of them, so points are
 * hidden and only every twelfth label is drawn. Baseline is grey because it is
 * the reference and should recede; the plan is blue. Neither is the accent:
 * verdigris is for action, never for data.
 */
export function DebtPaydownChart({
  comparison,
  startYear,
  startMonth,
}: {
  comparison: PaydownComparison;
  startYear: number;
  startMonth: number;
}): ReactElement | null {
  const theme = useThemeName();
  const chrome = chartChrome(theme);
  const pal = dataPalette(theme);

  const { baseline, plan } = comparison;
  if (paydownChartIsEmpty(comparison)) return null;
  const length = paydownChartPoints(comparison);

  const labels = Array.from({ length }, (_, i) => monthLabel(startYear, startMonth, i + 1));
  const pad = (series: number[]): (number | null)[] =>
    Array.from({ length }, (_, i) => (i < series.length ? series[i] : 0));

  const data = {
    labels,
    datasets: [
      {
        label: "Minimums, paid separately",
        data: pad(baseline.balanceSeries),
        borderColor: pal.grey,
        borderWidth: 2,
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0.2,
      },
      {
        label: "Your plan",
        data: pad(plan.balanceSeries),
        borderColor: pal.blue,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        display: true,
        position: "bottom",
        labels: { color: chrome.tick, boxWidth: 10, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
        callbacks: { label: (c) => `${c.dataset.label}: ${fmtUsd(Number(c.parsed.y))}` },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: chrome.tick,
          maxRotation: 0,
          autoSkip: false,
          // One tick a year: the label is "YYYY-MM", so slice the year off it.
          callback: (_v, i) => (i % 12 === 0 ? labels[i].slice(0, 4) : ""),
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: chrome.grid },
        ticks: { color: chrome.tick, callback: (v) => fmtUsd(Number(v)) },
      },
    },
  };

  return (
    <div className="h-[240px] w-full">
      <Line data={data} options={options} />
    </div>
  );
}

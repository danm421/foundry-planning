"use client";
import { useMemo, type ReactElement } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { useThemeName, chartChrome, dataPalette } from "@/lib/chart-colors";
import { fmtUsd, fmtUsdCompact, fmtMonthLabel } from "@/lib/portal/format";
import { yearTickStep } from "@/lib/portal/chart-ticks";
import { ChartLegendKey } from "@/components/portal/chart-legend-key";
import { monthLabel } from "@/lib/calculators/debt-paydown";
import type { SavingsGoalRun } from "@/lib/calculators/savings-goal";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip);

/**
 * What they'd have, month by month, against what the goal will cost by then.
 *
 * Both lines move: the balance compounds at their expected return, the goal at
 * inflation. Drawing the goal as a flat line would be a different — and wrong
 * — picture, and would not match the crossing date the screen quotes.
 *
 * The goal is grey and dashed because it is the reference and should recede;
 * the balance is a solid blue. Neither is the accent: verdigris is for action,
 * never for data. The legend is DOM rather than canvas so it reads in the
 * app's own type and tokens — the same call `DebtPaydownChart` makes.
 */
export function SavingsGoalChart({
  run,
  startYear,
  startMonth,
}: {
  run: SavingsGoalRun;
  startYear: number;
  startMonth: number;
}): ReactElement | null {
  const theme = useThemeName();
  const chrome = chartChrome(theme);
  const pal = dataPalette(theme);

  const length = run.balanceSeries.length;
  // Up to 601 month labels, rebuilt on every keystroke in the workspace
  // otherwise — `run` is a fresh object each time, but the labels depend only
  // on the horizon and the start month. Above the early return so the hook is
  // never conditional.
  const labels = useMemo(
    () => Array.from({ length }, (_, i) => monthLabel(startYear, startMonth, i + 1)),
    [length, startYear, startMonth],
  );

  // One point is "today" alone — a goal already due. There is no line to draw.
  if (length < 2) return null;

  const tickStep = yearTickStep(length);

  const summary = `What you'd have saved, month by month, against what the goal costs by then: ${fmtUsd(
    run.projected,
  )} against ${fmtUsd(run.targetAtGoal)} by ${fmtMonthLabel(labels[length - 1])}.`;

  const data = {
    labels,
    datasets: [
      {
        label: "What the goal costs",
        data: run.targetSeries,
        borderColor: pal.grey,
        borderWidth: 2,
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0.2,
      },
      {
        label: "What you'd have",
        data: run.balanceSeries,
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
    layout: { padding: { top: 8, right: 10 } },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
        borderColor: chrome.grid,
        borderWidth: 1,
        padding: 10,
        usePointStyle: true,
        callbacks: {
          title: (items) => fmtMonthLabel(String(items[0]?.label ?? "")),
          label: (c) => `${c.dataset.label}: ${fmtUsd(Number(c.parsed.y))}`,
          labelPointStyle: () => ({ pointStyle: "line" as const, rotation: 0 }),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: chrome.grid },
        ticks: {
          color: chrome.tick,
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: false,
          // The label is "YYYY-MM", so slice the year off it.
          callback: (_v, i) => (i % (12 * tickStep) === 0 ? labels[i].slice(0, 4) : ""),
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: chrome.grid },
        border: { display: false },
        ticks: {
          color: chrome.tick,
          font: { size: 10 },
          maxTicksLimit: 6,
          callback: (v) => fmtUsdCompact(Number(v)),
        },
      },
    },
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-[15px] font-medium text-ink">Getting there</h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <ChartLegendKey color={pal.blue} label="What you'd have" />
          <ChartLegendKey color={pal.grey} label="What the goal costs" dashed />
        </div>
      </div>
      <div className="h-[260px] w-full">
        <Line data={data} options={options} aria-label={summary} />
      </div>
    </div>
  );
}

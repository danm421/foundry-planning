// src/components/portal/budget-donut.tsx
"use client";
import type { ReactElement } from "react";
import { Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend, type ChartOptions,
} from "chart.js";
import { useThemeName, chartChrome, dataPalette } from "@/lib/chart-colors";
import { fmtUsd } from "@/lib/portal/format";
import type { GroupCell } from "@/lib/portal/budget-summary";

ChartJS.register(ArcElement, Tooltip, Legend);

/** Resolve a `var(--data-<key>)` token to a concrete hex Chart.js can paint. */
function tokenToHex(token: string, pal: Record<string, string>): string {
  const key = token.match(/var\(--data-([a-z]+)\)/)?.[1];
  return (key && pal[key]) || pal.grey || "#888888";
}

export function BudgetDonut({
  groups, totalSpent,
}: { groups: GroupCell[]; totalSpent: number }): ReactElement | null {
  const theme = useThemeName();
  const pal = dataPalette(theme) as unknown as Record<string, string>;
  const chrome = chartChrome(theme);

  const spend = groups.filter((g) => g.actual > 0);
  if (spend.length === 0) return null;

  const data = {
    labels: spend.map((g) => g.name),
    datasets: [
      {
        data: spend.map((g) => g.actual),
        backgroundColor: spend.map((g) => tokenToHex(g.color, pal)),
        borderWidth: 0,
      },
    ],
  };
  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
        callbacks: { label: (c) => `${c.label}: ${fmtUsd(Number(c.parsed))}` },
      },
    },
  };
  return (
    <div className="relative h-56">
      <Doughnut data={data} options={options} />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] text-ink-3">Spent</span>
        <span className="tabular text-[18px] font-semibold text-ink">{fmtUsd(totalSpent)}</span>
      </div>
    </div>
  );
}

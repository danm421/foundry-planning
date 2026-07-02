"use client";

import { useMemo } from "react";
import {
  BarController, BarElement, CategoryScale, Legend, LinearScale, Tooltip,
  Chart as ChartJS,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useThemeName } from "@/lib/chart-colors";
import { dataPalette, chartChrome } from "@/lib/chart-palette";
import type { EducationGoalReport } from "@/lib/reports/education-report-data";

ChartJS.register(BarController, BarElement, CategoryScale, Legend, LinearScale, Tooltip);

export function EducationChart({ chart }: { chart: EducationGoalReport["chart"] }) {
  const theme = useThemeName();
  const palette = dataPalette(theme);
  const chrome = chartChrome(theme);

  const data = useMemo(
    () => ({
      labels: chart.labels,
      datasets: [
        { label: "Dedicated Funds Remaining", data: chart.remaining, backgroundColor: palette.blue, stack: "edu" },
        { label: "Dedicated Withdrawals", data: chart.withdrawals, backgroundColor: palette.green, stack: "edu" },
        { label: "Cash-Flow Withdrawals", data: chart.outOfPocket, backgroundColor: palette.yellow, stack: "edu" },
        { label: "Shortfall", data: chart.shortfall, backgroundColor: palette.red, stack: "edu" },
      ],
    }),
    [chart, palette],
  );

  return (
    <Bar
      data={data}
      options={{
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
          y: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        },
        plugins: {
          legend: { labels: { color: chrome.legend } },
          tooltip: { backgroundColor: chrome.tooltipBg, titleColor: chrome.tooltipTitle, bodyColor: chrome.tooltipBody },
        },
      }}
    />
  );
}

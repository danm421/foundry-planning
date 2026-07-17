// src/app/(app)/home/book/_components/book-split-chart.tsx
"use client";

import { useMemo } from "react";
import type { ReactElement } from "react";
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useThemeName, chartChrome } from "@/lib/chart-colors";
import { data as brandData, dataLight as brandDataLight } from "@/brand";
import type { BookBreakdown } from "@/lib/home/book-breakdown";

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const fmtCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const TOP_N = 6;

export function BookSplitChart({ data }: { data: BookBreakdown }): ReactElement {
  const theme = useThemeName();
  const palette = theme === "light" ? brandDataLight : brandData;
  const chrome = chartChrome(theme);

  const chartData = useMemo(() => {
    const top = [...data.households].sort((a, b) => b.total - a.total).slice(0, TOP_N);
    return {
      labels: top.map((h) => h.householdName),
      datasets: [
        { label: "Book value", data: top.map((h) => h.bookValue), backgroundColor: palette.blue, stack: "s" },
        { label: "Held away", data: top.map((h) => h.heldAway), backgroundColor: palette.orange, stack: "s" },
      ],
    };
  }, [data.households, palette]);

  return (
    <div className="h-[260px] w-full">
      <Bar
        data={chartData}
        options={{
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              stacked: true,
              ticks: { color: chrome.tick, callback: (v) => fmtCompact.format(Number(v)) },
              grid: { color: chrome.grid },
            },
            y: {
              stacked: true,
              ticks: { color: chrome.tick },
              grid: { color: chrome.grid },
            },
          },
          plugins: {
            legend: { position: "bottom", labels: { color: chrome.legend } },
            tooltip: {
              backgroundColor: chrome.tooltipBg,
              titleColor: chrome.tooltipTitle,
              bodyColor: chrome.tooltipBody,
              callbacks: { label: (c) => `${c.dataset.label}: ${fmtCompact.format(Number(c.parsed.x))}` },
            },
          },
        }}
      />
    </div>
  );
}

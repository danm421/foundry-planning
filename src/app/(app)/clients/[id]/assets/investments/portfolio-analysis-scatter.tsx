"use client";

import { Chart as ChartJS, LinearScale, PointElement, Tooltip, Legend } from "chart.js";
import { Scatter } from "react-chartjs-2";
import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { pct, axisBounds } from "./scatter-axis";

ChartJS.register(LinearScale, PointElement, Tooltip, Legend);

export function PortfolioAnalysisScatter({
  rows,
  colorMap,
}: {
  rows: AnalysisRow[];
  colorMap: Map<string, string>;
}) {
  const theme = useThemeName();
  const chrome = chartChrome(theme);

  const xBounds = axisBounds(rows.map((r) => r.stats.stdDev));
  const yBounds = axisBounds(rows.map((r) => r.stats.arithmeticMean));

  // One dataset per plotted entity so the legend lists each by its table name,
  // each in its own color.
  const datasets = rows.map((r) => ({
    label: r.name,
    pointStyle: "circle" as const,
    pointRadius: 7,
    pointHoverRadius: 9,
    backgroundColor: colorMap.get(r.key) ?? "var(--color-accent)",
    borderColor: "var(--color-card)",
    borderWidth: 1.5,
    data: [{ x: r.stats.stdDev, y: r.stats.arithmeticMean, _row: r }],
  }));

  return (
    <Scatter
      data={{ datasets }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            min: xBounds.min,
            max: xBounds.max,
            title: { display: true, text: "Standard Deviation", color: chrome.title, font: { size: 13, weight: "bold" } },
            ticks: { color: chrome.tick, stepSize: 0.01, callback: (v) => pct(Number(v)) },
            grid: { color: chrome.grid },
            border: { color: chrome.legend, width: 2 },
          },
          y: {
            min: yBounds.min,
            max: yBounds.max,
            title: { display: true, text: "Arithmetic Mean Return", color: chrome.title, font: { size: 13, weight: "bold" } },
            ticks: { color: chrome.tick, stepSize: 0.01, callback: (v) => pct(Number(v)) },
            grid: { color: chrome.grid },
            border: { color: chrome.legend, width: 2 },
          },
        },
        plugins: {
          legend: { position: "bottom", labels: { color: chrome.legend, usePointStyle: true } },
          tooltip: {
            backgroundColor: chrome.tooltipBg,
            titleColor: chrome.tooltipTitle,
            bodyColor: chrome.tooltipBody,
            callbacks: {
              label: (item) => {
                const r = (item.raw as { _row: AnalysisRow })._row;
                return `${r.name} — return ${pct(r.stats.arithmeticMean)}, σ ${pct(r.stats.stdDev)}`;
              },
            },
          },
        },
      }}
    />
  );
}

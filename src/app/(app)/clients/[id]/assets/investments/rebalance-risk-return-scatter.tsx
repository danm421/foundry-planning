"use client";

import { Chart as ChartJS, LinearScale, PointElement, Tooltip, Legend } from "chart.js";
import { Scatter } from "react-chartjs-2";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import type { RiskReturnStats } from "@/lib/investments/portfolio-stats";

ChartJS.register(LinearScale, PointElement, Tooltip, Legend);

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function axisBounds(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 0.1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return {
    min: Math.max(0, round2(Math.floor(lo * 100) / 100 - 0.04)),
    max: round2(Math.ceil(hi * 100) / 100 + 0.02),
  };
}

export function RebalanceRiskReturnScatter({
  current,
  proposed,
}: {
  current: RiskReturnStats;
  proposed: RiskReturnStats;
}) {
  const theme = useThemeName();
  const chrome = chartChrome(theme);

  const points = [
    { label: "Current", stats: current, color: "var(--color-ink-2)" },
    { label: "Proposed", stats: proposed, color: "var(--color-accent)" },
  ];
  const xBounds = axisBounds(points.map((p) => p.stats.stdDev));
  const yBounds = axisBounds(points.map((p) => p.stats.arithmeticMean));

  const datasets = points.map((p) => ({
    label: p.label,
    pointStyle: "circle" as const,
    pointRadius: 8,
    pointHoverRadius: 10,
    backgroundColor: p.color,
    borderColor: "var(--color-card)",
    borderWidth: 1.5,
    data: [{ x: p.stats.stdDev, y: p.stats.arithmeticMean }],
  }));

  return (
    <div className="rounded-lg border border-hair-2 bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-ink">Risk / return (CMA)</h3>
      <div className="h-64">
        <Scatter
          data={{ datasets }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                min: xBounds.min,
                max: xBounds.max,
                title: { display: true, text: "Std deviation", color: chrome.title, font: { size: 12, weight: "bold" } },
                ticks: { color: chrome.tick, stepSize: 0.01, callback: (v) => pct(Number(v)) },
                grid: { color: chrome.grid },
                border: { color: chrome.legend, width: 2 },
              },
              y: {
                min: yBounds.min,
                max: yBounds.max,
                title: { display: true, text: "Expected return", color: chrome.title, font: { size: 12, weight: "bold" } },
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
                    const d = item.raw as { x: number; y: number };
                    return `${item.dataset.label} — return ${pct(d.y)}, σ ${pct(d.x)}`;
                  },
                },
              },
            },
          }}
        />
      </div>
    </div>
  );
}

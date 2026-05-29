"use client";

import { Chart as ChartJS, LinearScale, PointElement, Tooltip, Legend } from "chart.js";
import { Scatter } from "react-chartjs-2";
import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";
import { colorForAssetClass } from "@/lib/investments/palette";

ChartJS.register(LinearScale, PointElement, Tooltip, Legend);

const SERIES: { type: AnalysisRow["type"]; label: string; pointStyle: string; color: string }[] = [
  { type: "asset_class", label: "Asset Classes", pointStyle: "circle", color: "#3b82f6" },
  { type: "account", label: "Accounts", pointStyle: "rect", color: "#10b981" },
  { type: "category", label: "Account Categories", pointStyle: "triangle", color: "#f59e0b" },
  { type: "custom_group", label: "Custom Groups", pointStyle: "rectRot", color: "#8b5cf6" },
  { type: "model_portfolio", label: "Model Portfolios", pointStyle: "star", color: "#ec4899" },
];

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function PortfolioAnalysisScatter({ rows }: { rows: AnalysisRow[] }) {
  const datasets = SERIES.map((s) => {
    const seriesRows = rows.filter((r) => r.type === s.type);
    return {
      label: s.label,
      pointStyle: s.pointStyle,
      pointRadius: 7,
      pointHoverRadius: 9,
      backgroundColor: seriesRows.map((r) =>
        r.type === "asset_class" && r.sortOrder !== undefined
          ? colorForAssetClass({ sortOrder: r.sortOrder })
          : s.color,
      ),
      borderColor: "#111827",
      borderWidth: 1,
      data: seriesRows.map((r) => ({ x: r.stats.stdDev, y: r.stats.arithmeticMean, _row: r })),
    };
  });

  return (
    <Scatter
      data={{ datasets }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { title: { display: true, text: "Standard Deviation" }, ticks: { callback: (v) => pct(Number(v)) } },
          y: { title: { display: true, text: "Arithmetic Mean Return" }, ticks: { callback: (v) => pct(Number(v)) } },
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
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

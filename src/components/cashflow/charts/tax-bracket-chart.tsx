"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * Derives effective and marginal federal tax rates from `taxResult.diag` —
 * the same fields used by buildTaxBracketRows in src/lib/tax/bracket.ts.
 * Years without a taxResult yield 0 for both rates (matches that helper's
 * skip-rather-than-fabricate philosophy, mapped to 0 for chart continuity).
 */
export function buildTaxBracketSeries(years: ProjectionYear[]): {
  effective: number[];
  marginal: number[];
} {
  const effective: number[] = [];
  const marginal: number[] = [];

  for (const year of years) {
    const diag = year.taxResult?.diag;
    effective.push(diag?.effectiveFederalRate ?? 0);
    marginal.push(diag?.marginalFederalRate ?? 0);
  }

  return { effective, marginal };
}

interface TaxBracketChartProps {
  years: ProjectionYear[];
}

export function TaxBracketChart({ years }: TaxBracketChartProps) {
  const { effective, marginal } = buildTaxBracketSeries(years);

  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: [
        {
          label: "Effective rate",
          data: effective,
          borderColor: "#2563eb",
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          stepped: "before" as const,
        },
        {
          label: "Marginal rate",
          data: marginal,
          borderColor: "#ef4444",
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          stepped: "before" as const,
          borderDash: [4, 4],
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [years],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: "#d1d5db", boxWidth: 12, padding: 16 },
        },
        title: {
          display: true,
          text: "Effective vs. marginal rate",
          color: "#f3f4f6",
          font: { size: 14 },
        },
        tooltip: {
          backgroundColor: "#1f2937",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${pct(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: "#9ca3af" }, grid: { color: "#374151" } },
        y: {
          beginAtZero: true,
          max: 0.5,
          ticks: {
            color: "#9ca3af",
            callback: (value: unknown) => pct(Number(value)),
          },
          grid: { color: "#374151" },
        },
      },
    }),
    [],
  );

  if (years.length === 0) return null;
  return (
    <div style={{ height: 300 }}>
      <Line data={data} options={options} />
    </div>
  );
}

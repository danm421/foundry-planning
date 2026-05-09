"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import type { StackedBarSeries } from "./stacked-bar-chart";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Reuse the same Series shape as StackedBarChart so the tests look familiar. */
export function buildPortfolioDatasets(): StackedBarSeries[] {
  return [
    { label: "Cash",                    color: "#9ca3af", valueFor: (y) => y.portfolioAssets.cashTotal },
    { label: "Taxable",                 color: "#facc15", valueFor: (y) => y.portfolioAssets.taxableTotal },
    { label: "Retirement",             color: "#f97316", valueFor: (y) => y.portfolioAssets.retirementTotal },
    { label: "Life Insurance",          color: "#16a34a", valueFor: (y) => y.portfolioAssets.lifeInsuranceTotal },
    { label: "Real Estate",             color: "#0891b2", valueFor: (y) => y.portfolioAssets.realEstateTotal },
    { label: "Business",               color: "#7c3aed", valueFor: (y) => y.portfolioAssets.businessTotal },
    { label: "Trusts & Businesses",     color: "#2563eb", valueFor: (y) => y.portfolioAssets.trustsAndBusinessesTotal },
    { label: "Accessible Trust Assets", color: "#99f6e4", valueFor: (y) => y.portfolioAssets.accessibleTrustAssetsTotal },
  ];
}

interface PortfolioChartProps {
  years: ProjectionYear[];
}

export function PortfolioChart({ years }: PortfolioChartProps) {
  const series = buildPortfolioDatasets();

  const data = useMemo(() => {
    if (years.length === 0) return null;
    return {
      labels: years.map((y) => String(y.year)),
      datasets: series.map((s, i) => ({
        label: s.label,
        data: years.map(s.valueFor),
        backgroundColor: s.color,
        borderColor: s.color,
        borderWidth: 1,
        pointRadius: 0,
        fill: i === 0 ? "origin" : "-1",
        tension: 0.2,
      })),
    };
  }, [years, series]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: "#d1d5db", boxWidth: 12, padding: 16 } },
        title: { display: true, text: "Portfolio assets by category", color: "#f3f4f6", font: { size: 14 } },
        tooltip: {
          backgroundColor: "#1f2937",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${fmt.format(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#374151" } },
        y: {
          stacked: true,
          ticks: {
            color: "#9ca3af",
            callback: (value: unknown) => fmt.format(Number(value)),
          },
          grid: { color: "#374151" },
        },
      },
    }),
    [],
  );

  if (!data) return null;
  return (
    <div style={{ height: 300 }}>
      <Line data={data} options={options} />
    </div>
  );
}

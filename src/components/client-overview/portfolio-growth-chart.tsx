"use client";

import { useMemo } from "react";
import { useThemeName, chartChrome, dataPalette } from "@/lib/chart-colors";
import { liquidPortfolioTotal } from "@/components/charts/portfolio-bars-data";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmtFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const fmtCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

interface Props {
  years: ProjectionYear[];
}

export default function PortfolioGrowthChart({ years }: Props) {
  const theme = useThemeName();
  const chrome = chartChrome(theme);
  // Deep Jewel blue — the "portfolio" anchor of the chart palette.
  const seriesColor = dataPalette(theme).blue;

  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: [
        {
          label: "Liquid portfolio",
          // Liquid investable total only (taxable + cash + retirement + life
          // insurance + accessible trusts) — the same basis the Cash Flow chart
          // uses. Excludes real estate, business, and locked trusts.
          data: years.map((y) => liquidPortfolioTotal(y)),
          backgroundColor: seriesColor,
          borderRadius: 2,
        },
      ],
    }),
    [years, seriesColor],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            label: (ctx: { raw: unknown }) =>
              `Liquid portfolio: ${fmtFull.format(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: chrome.tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: chrome.tick,
            callback: (value: unknown) => fmtCompact.format(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    }),
    [chrome],
  );

  if (years.length === 0) return null;
  return (
    <div style={{ height: 260 }}>
      <Bar data={data} options={options} />
    </div>
  );
}

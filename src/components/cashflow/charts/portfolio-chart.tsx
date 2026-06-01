"use client";

import { useCallback, useMemo, useRef } from "react";
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
import { useChartCapture } from "@/lib/report-artifacts/chart-capture";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Reuse the same Series shape as StackedBarChart so the tests look familiar.
 * H1: stack only the five liquid investable buckets so the bar height ties to
 * portfolioAssets.liquidTotal — the canonical "Portfolio Assets" total shared by
 * the summary cell and next-year BoY. Real estate / business / locked trusts are
 * net-worth, not portfolio; they belong on a separate balance-sheet view
 * (follow-up — see future-work/reports).
 */
// Each series carries a Deep Jewel palette key; PortfolioChart resolves it to a
// theme-aware hex (Chart.js paints to canvas, which can't read CSS vars).
export function buildPortfolioDatasets(): StackedBarSeries[] {
  return [
    { label: "Cash",                    colorKey: "teal",   valueFor: (y) => y.portfolioAssets.cashTotal },
    { label: "Taxable",                 colorKey: "yellow", valueFor: (y) => y.portfolioAssets.taxableTotal },
    { label: "Retirement",              colorKey: "orange", valueFor: (y) => y.portfolioAssets.retirementTotal },
    { label: "Life Insurance",          colorKey: "green",  valueFor: (y) => y.portfolioAssets.lifeInsuranceTotal },
    { label: "Accessible Trust Assets", colorKey: "grey",   valueFor: (y) => y.portfolioAssets.accessibleTrustAssetsTotal },
  ];
}

interface PortfolioChartProps {
  years: ProjectionYear[];
  dataVersion: string;
}

export function PortfolioChart({ years, dataVersion }: PortfolioChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useChartCapture(
    { reportId: "cashflow", chartId: "assets", dataVersion },
    useCallback(() => ref.current?.querySelector("canvas") ?? null, []),
  );
  const theme = useThemeName();
  const series = buildPortfolioDatasets();

  const data = useMemo(() => {
    if (years.length === 0) return null;
    const pal = dataPalette(theme);
    return {
      labels: years.map((y) => String(y.year)),
      datasets: series.map((s, i) => {
        const color = s.colorKey ? pal[s.colorKey] : pal.grey;
        return {
          label: s.label,
          data: years.map(s.valueFor),
          backgroundColor: color,
          borderColor: color,
          borderWidth: 1,
          pointRadius: 0,
          fill: i === 0 ? "origin" : "-1",
          tension: 0.2,
        };
      }),
    };
  }, [years, series, theme]);

  const options = useMemo(
    () => {
      const chrome = chartChrome(theme);
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: chrome.legend, boxWidth: 12, padding: 16 } },
          title: { display: true, text: "Liquid portfolio by category", color: chrome.title, font: { size: 14 } },
          tooltip: {
            backgroundColor: chrome.tooltipBg,
            titleColor: chrome.tooltipTitle,
            bodyColor: chrome.tooltipBody,
            callbacks: {
              label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
                `${ctx.dataset.label}: ${fmt.format(Number(ctx.raw))}`,
            },
          },
        },
        scales: {
          x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
          y: {
            stacked: true,
            ticks: {
              color: chrome.tick,
              callback: (value: unknown) => fmt.format(Number(value)),
            },
            grid: { color: chrome.grid },
          },
        },
      };
    },
    [theme],
  );

  if (!data) return null;
  return (
    <div ref={ref}>
      <div style={{ height: 300 }}>
        <Line data={data} options={options} />
      </div>
    </div>
  );
}

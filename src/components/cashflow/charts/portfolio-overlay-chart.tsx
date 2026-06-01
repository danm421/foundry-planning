"use client";

import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine/types";
import { seriesColor, seriesDash } from "@/lib/comparison/series-palette";
import { chartChrome, useThemeName } from "@/lib/chart-colors";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Portfolio total = liquid investable buckets only (cash + taxable + retirement
// + life insurance). Real estate, business, and entity/trust-owned shares live
// on the balance sheet, not in Portfolio Assets.
function portfolioTotalForYear(y: ProjectionYear): number {
  const pa = y.portfolioAssets as unknown as {
    taxableTotal?: number;
    cashTotal?: number;
    retirementTotal?: number;
    lifeInsuranceTotal?: number;
  };
  return (
    (pa?.cashTotal ?? 0) +
    (pa?.taxableTotal ?? 0) +
    (pa?.retirementTotal ?? 0) +
    (pa?.lifeInsuranceTotal ?? 0)
  );
}

export interface PortfolioOverlaySeries {
  label: string;
  years: ProjectionYear[];
}

interface Props {
  plans: PortfolioOverlaySeries[];
}

export function PortfolioOverlayChart({ plans }: Props) {
  const theme = useThemeName();

  // Union of all years across plans (sorted). Plans may diverge in horizon
  // (different retirement ages, longevity assumptions); span the union so each
  // series shows its own end-state instead of being truncated to the shortest.
  const allYears = Array.from(
    new Set(plans.flatMap((p) => p.years.map((y) => y.year))),
  ).sort((a, b) => a - b);

  const datasets = plans.map((p, i) => {
    const byYear = new Map<number, number>(
      p.years.map((y) => [y.year, portfolioTotalForYear(y)]),
    );
    const color = seriesColor(i) ?? "var(--color-data-slate)";
    return {
      label: p.label,
      data: allYears.map((yr) => byYear.get(yr) ?? null),
      borderColor: color,
      backgroundColor: color,
      borderDash: [...(seriesDash(i) ?? [])],
      fill: false,
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.2,
      spanGaps: true,
    };
  });

  const chrome = chartChrome(theme);

  return (
    <div className="h-72 w-full">
      <Line
        data={{ labels: allYears, datasets }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", labels: { color: chrome.legend } },
            tooltip: {
              backgroundColor: chrome.tooltipBg,
              titleColor: chrome.tooltipTitle,
              bodyColor: chrome.tooltipBody,
              callbacks: {
                label: (ctx) =>
                  `${ctx.dataset.label}: ${usd.format((ctx.parsed.y as number) ?? 0)}`,
              },
            },
          },
          scales: {
            x: {
              ticks: { color: chrome.tick },
              grid: { color: chrome.grid },
            },
            y: {
              ticks: {
                color: chrome.tick,
                callback: (v) => usd.format(Number(v)),
              },
              grid: { color: chrome.grid },
            },
          },
        }}
      />
    </div>
  );
}

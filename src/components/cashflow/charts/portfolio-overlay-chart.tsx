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
    const color = seriesColor(i) ?? "#cbd5e1";
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

  return (
    <div className="h-72 w-full">
      <Line
        data={{ labels: allYears, datasets }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", labels: { color: "#cbd5e1" } },
            tooltip: {
              callbacks: {
                label: (ctx) =>
                  `${ctx.dataset.label}: ${usd.format((ctx.parsed.y as number) ?? 0)}`,
              },
            },
          },
          scales: {
            x: {
              ticks: { color: "#94a3b8" },
              grid: { color: "rgba(148,163,184,0.15)" },
            },
            y: {
              ticks: {
                color: "#94a3b8",
                callback: (v) => usd.format(Number(v)),
              },
              grid: { color: "rgba(148,163,184,0.15)" },
            },
          },
        }}
      />
    </div>
  );
}

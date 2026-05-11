"use client";

import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from "chart.js";
import type { TooltipItem } from "chart.js";
import type { LifetimeTaxBuckets } from "@/lib/comparison/lifetime-tax";
import { seriesColor } from "@/lib/comparison/series-palette";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const BUCKET_LABELS: Record<keyof LifetimeTaxBuckets, string> = {
  regularFederalIncomeTax: "Federal income tax",
  capitalGainsTax: "Capital gains tax",
  amtAdditional: "AMT",
  niit: "NIIT",
  additionalMedicare: "Additional Medicare",
  fica: "FICA",
  stateTax: "State tax",
};

const BUCKET_KEYS: ReadonlyArray<keyof LifetimeTaxBuckets> = [
  "regularFederalIncomeTax", "capitalGainsTax", "amtAdditional", "niit",
  "additionalMedicare", "fica", "stateTax",
];

export interface PlanLifetimeTax {
  label: string;
  buckets: LifetimeTaxBuckets;
}

interface Props { plans: PlanLifetimeTax[]; }

export function LifetimeTaxComparisonChart({ plans }: Props) {
  const visibleKeys = BUCKET_KEYS.filter((k) => plans.some((p) => p.buckets[k] > 0));
  const labels = visibleKeys.map((k) => BUCKET_LABELS[k]);
  const data = {
    labels,
    datasets: plans.map((p, i) => ({
      label: p.label,
      data: visibleKeys.map((k) => p.buckets[k]),
      backgroundColor: seriesColor(i) ?? "#cbd5e1",
    })),
  };
  return (
    <div className="h-80 w-full">
      <Bar
        data={data}
        options={{
          indexAxis: "y" as const,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" as const, labels: { color: "#cbd5e1" } },
            tooltip: {
              callbacks: {
                label: (ctx: TooltipItem<"bar">) =>
                  `${ctx.dataset.label}: ${usd.format(ctx.parsed.x ?? 0)}`,
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: "#94a3b8",
                callback: (v: number | string) => usd.format(Number(v)),
              },
              grid: { color: "rgba(148, 163, 184, 0.15)" },
            },
            y: { ticks: { color: "#cbd5e1" }, grid: { display: false } },
          },
        }}
      />
    </div>
  );
}

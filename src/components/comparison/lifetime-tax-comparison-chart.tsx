"use client";

import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from "chart.js";
import type { LifetimeTaxBuckets } from "@/lib/comparison/lifetime-tax";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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

interface Props {
  plan1Buckets: LifetimeTaxBuckets;
  plan2Buckets: LifetimeTaxBuckets;
  plan1Label: string;
  plan2Label: string;
}

export function LifetimeTaxComparisonChart({ plan1Buckets, plan2Buckets, plan1Label, plan2Label }: Props) {
  const visibleKeys = BUCKET_KEYS.filter((k) => plan1Buckets[k] > 0 || plan2Buckets[k] > 0);
  const labels = visibleKeys.map((k) => BUCKET_LABELS[k]);
  const data = {
    labels,
    datasets: [
      {
        label: plan1Label,
        data: visibleKeys.map((k) => plan1Buckets[k]),
        backgroundColor: "#60a5fa",
      },
      {
        label: plan2Label,
        data: visibleKeys.map((k) => plan2Buckets[k]),
        backgroundColor: "#f97316",
      },
    ],
  };
  const options = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" as const, labels: { color: "#cbd5e1" } },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { x: number } }) =>
            `${ctx.dataset.label}: ${usd.format(ctx.parsed.x)}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: "#94a3b8", callback: (v: number | string) => usd.format(Number(v)) }, grid: { color: "rgba(148, 163, 184, 0.15)" } },
      y: { ticks: { color: "#cbd5e1" }, grid: { display: false } },
    },
  };
  return (
    <div className="h-80 w-full">
      <Bar data={data} options={options} />
    </div>
  );
}

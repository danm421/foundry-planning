"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from "chart.js";
import type { TooltipItem } from "chart.js";
import type { LifetimeTaxBuckets } from "@/lib/comparison/lifetime-tax";
import { seriesColor } from "@/lib/comparison/series-palette";
import { chartChrome, useThemeName } from "@/lib/chart-colors";

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
  const theme = useThemeName();

  const visibleKeys = BUCKET_KEYS.filter((k) => plans.some((p) => p.buckets[k] > 0));
  const labels = visibleKeys.map((k) => BUCKET_LABELS[k]);

  const data = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      labels,
      datasets: plans.map((p, i) => ({
        label: p.label,
        data: visibleKeys.map((k) => p.buckets[k]),
        backgroundColor: seriesColor(i) ?? chrome.tick,
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, theme]);

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" as const, labels: { color: chrome.legend } },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            label: (ctx: TooltipItem<"bar">) =>
              `${ctx.dataset.label}: ${usd.format(ctx.parsed.x ?? 0)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: chrome.tick,
            callback: (v: number | string) => usd.format(Number(v)),
          },
          grid: { color: chrome.grid },
        },
        y: { ticks: { color: chrome.legend }, grid: { display: false } },
      },
    };
  }, [theme]);

  return (
    <div className="h-80 w-full">
      <Bar data={data} options={options} />
    </div>
  );
}

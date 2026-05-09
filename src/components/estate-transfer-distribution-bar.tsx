"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { RecipientTotal } from "@/lib/estate/transfer-report";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Props {
  totals: RecipientTotal[];
  colors: Record<string, string>;
}

export function EstateTransferDistributionBar({ totals, colors }: Props) {
  const grand = totals.reduce((s, t) => s + t.total, 0);

  const data = useMemo(() => {
    if (totals.length === 0 || grand <= 0) return null;
    return {
      labels: ["Net inheritance"],
      datasets: totals.map((t) => ({
        label: t.recipientLabel,
        data: [t.total],
        backgroundColor: colors[t.key] ?? "#6b7280",
        stack: "main",
        borderWidth: 0,
      })),
    };
  }, [totals, grand, colors]);

  const options = useMemo(
    () => ({
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1f2937",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) => {
              const v = Number(ctx.raw);
              const pct = grand > 0 ? (v / grand) * 100 : 0;
              return `${ctx.dataset.label}: ${fmt.format(v)} (${pct.toFixed(1)}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          display: false,
          grid: { display: false },
        },
        y: {
          stacked: true,
          display: false,
          grid: { display: false },
        },
      },
    }),
    [grand],
  );

  if (!data) return null;

  return (
    <div className="space-y-2">
      <div style={{ height: 36 }}>
        <Bar data={data} options={options} />
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-300">
        {totals.map((t) => {
          const pct = grand > 0 ? (t.total / grand) * 100 : 0;
          return (
            <li key={t.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: colors[t.key] ?? "#6b7280" }}
              />
              <span data-testid="recipient-label" className="text-gray-200">
                {t.recipientLabel}
              </span>
              <span className="font-mono tabular-nums text-gray-400">
                {pct.toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

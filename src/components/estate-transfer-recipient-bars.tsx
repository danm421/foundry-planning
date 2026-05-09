"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { RecipientTotal } from "@/lib/estate/transfer-report";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Append an alpha byte to a 6-char hex color. 0x66 ≈ 0.4; 0xa6 ≈ 0.65. */
function withAlpha(hex: string, alphaByte: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `${hex}${alphaByte}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

interface Props {
  totals: RecipientTotal[];
  colors: Record<string, string>;
}

export function EstateTransferRecipientBars({ totals, colors }: Props) {
  const data = useMemo(() => {
    if (totals.length === 0) return null;
    const labels = totals.map((t) => truncate(t.recipientLabel, 14));
    return {
      labels,
      datasets: [
        {
          label: "From 1st Death",
          data: totals.map((t) => t.fromFirstDeath),
          backgroundColor: totals.map((t) =>
            withAlpha(colors[t.key] ?? "#6b7280", "a6"),
          ),
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "From 2nd Death",
          data: totals.map((t) => t.fromSecondDeath),
          backgroundColor: totals.map((t) => colors[t.key] ?? "#6b7280"),
          stack: "main",
          borderWidth: 0,
        },
      ],
    };
  }, [totals, colors]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "bottom" as const,
          labels: { color: "#d1d5db", boxWidth: 12, padding: 12 },
        },
        tooltip: {
          backgroundColor: "#1f2937",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          callbacks: {
            title: (items: Array<{ dataIndex: number }>) =>
              totals[items[0]?.dataIndex]?.recipientLabel ?? "",
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${fmt.format(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: false },
          grid: { color: "#374151" },
        },
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
    [totals],
  );

  if (!data) return null;

  return (
    <div style={{ height: 280 }}>
      <Bar data={data} options={options} />
    </div>
  );
}

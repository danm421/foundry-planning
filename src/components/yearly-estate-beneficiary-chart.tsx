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
import type { YearlyBeneficiaryBreakdown } from "@/lib/estate/yearly-beneficiary-breakdown";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Append an alpha byte to a 6-char hex color. 0xa6 ≈ 65%. */
function withAlpha(hex: string, alphaByte: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `${hex}${alphaByte}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

interface Props {
  breakdown: YearlyBeneficiaryBreakdown;
  colors: Record<string, string>;
}

/**
 * Renders the final-year hypothetical inheritance per non-spouse beneficiary
 * — one bar per beneficiary, stacked by 1st-death (lighter) and 2nd-death
 * (full color). Uses the last row of the breakdown as the "if both die at
 * end of plan" snapshot. Beneficiaries with zero in that final year are
 * still shown so the visual ordering matches the lifetime sort.
 */
export function YearlyEstateBeneficiaryChart({ breakdown, colors }: Props) {
  const data = useMemo(() => {
    if (breakdown.rows.length === 0 || breakdown.beneficiaries.length === 0) {
      return null;
    }
    const finalRow = breakdown.rows[breakdown.rows.length - 1];
    const finalShares = new Map(
      finalRow.beneficiaries.map((b) => [b.key, b]),
    );
    const labels = breakdown.beneficiaries.map((b) =>
      truncate(b.recipientLabel, 14),
    );
    const firstData = breakdown.beneficiaries.map(
      (b) => finalShares.get(b.key)?.fromFirstDeath ?? 0,
    );
    const secondData = breakdown.beneficiaries.map(
      (b) => finalShares.get(b.key)?.fromSecondDeath ?? 0,
    );
    return {
      labels,
      datasets: [
        {
          label: "From 1st Death",
          data: firstData,
          backgroundColor: breakdown.beneficiaries.map((b) =>
            withAlpha(colors[b.key] ?? "#6b7280", "a6"),
          ),
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "From 2nd Death",
          data: secondData,
          backgroundColor: breakdown.beneficiaries.map(
            (b) => colors[b.key] ?? "#6b7280",
          ),
          stack: "main",
          borderWidth: 0,
        },
      ],
    };
  }, [breakdown, colors]);

  const finalYear = breakdown.rows[breakdown.rows.length - 1]?.year;

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
              breakdown.beneficiaries[items[0]?.dataIndex]?.recipientLabel ??
              "",
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
    [breakdown.beneficiaries],
  );

  if (!data) return null;

  return (
    <div className="space-y-2">
      {finalYear != null && (
        <p className="text-[11px] text-gray-400">
          If both deaths occur by end of {finalYear}
        </p>
      )}
      <div style={{ height: 280 }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

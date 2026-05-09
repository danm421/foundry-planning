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

/** Append an alpha byte to a 6-char hex color. 0xa6 ≈ 65%. */
function withAlpha(hex: string, alphaByte: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `${hex}${alphaByte}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

interface Props {
  /** Non-spouse recipient totals from a split-mode (actual projected death
   *  years) call to buildEstateTransferReportData. Each entry carries the
   *  net amount routed to the beneficiary at first and second death. */
  recipients: RecipientTotal[];
  colors: Record<string, string>;
  firstDeathYear: number | null;
  secondDeathYear: number | null;
}

/**
 * Renders one bar per non-spouse beneficiary, stacked by from-1st-death
 * (lighter shade) and from-2nd-death (full color). Sourced from split-mode
 * aggregate totals so the deaths are at their actual projected years.
 */
export function YearlyEstateBeneficiaryChart({
  recipients,
  colors,
  firstDeathYear,
  secondDeathYear,
}: Props) {
  const data = useMemo(() => {
    if (recipients.length === 0) return null;
    return {
      labels: recipients.map((r) => truncate(r.recipientLabel, 14)),
      datasets: [
        {
          label: "From 1st Death",
          data: recipients.map((r) => r.fromFirstDeath),
          backgroundColor: recipients.map((r) =>
            withAlpha(colors[r.key] ?? "#6b7280", "a6"),
          ),
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "From 2nd Death",
          data: recipients.map((r) => r.fromSecondDeath),
          backgroundColor: recipients.map(
            (r) => colors[r.key] ?? "#6b7280",
          ),
          stack: "main",
          borderWidth: 0,
        },
      ],
    };
  }, [recipients, colors]);

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
              recipients[items[0]?.dataIndex]?.recipientLabel ?? "",
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
    [recipients],
  );

  if (!data) return null;

  const caption = buildCaption(firstDeathYear, secondDeathYear);

  return (
    <div className="space-y-2">
      {caption && <p className="text-[11px] text-gray-400">{caption}</p>}
      <div style={{ height: 280 }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

function buildCaption(
  firstDeathYear: number | null,
  secondDeathYear: number | null,
): string | null {
  if (firstDeathYear == null && secondDeathYear == null) return null;
  if (firstDeathYear != null && secondDeathYear != null) {
    return `Actual projected deaths · 1st in ${firstDeathYear}, 2nd in ${secondDeathYear}`;
  }
  return `Actual projected death · ${firstDeathYear ?? secondDeathYear}`;
}

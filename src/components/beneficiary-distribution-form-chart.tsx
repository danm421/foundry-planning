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
import type { BeneficiaryDistributionTotal } from "@/lib/estate/derive-beneficiary-distribution-form";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const OUTRIGHT_COLOR = "#34d399"; // emerald
const IN_TRUST_COLOR = "#60a5fa"; // blue

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

interface Props {
  /** Per-beneficiary outright/in-trust totals from
   *  `deriveBeneficiaryDistributionForm`. */
  beneficiaries: BeneficiaryDistributionTotal[];
}

/**
 * One bar per beneficiary, stacked into the outright portion (emerald) and
 * the in-trust portion (blue). Bar height is the beneficiary's total receipt
 * across both deaths.
 */
export function BeneficiaryDistributionFormChart({ beneficiaries }: Props) {
  const data = useMemo(() => {
    if (beneficiaries.length === 0) return null;
    return {
      labels: beneficiaries.map((b) => truncate(b.label, 14)),
      datasets: [
        {
          label: "Outright",
          data: beneficiaries.map((b) => b.outright),
          backgroundColor: OUTRIGHT_COLOR,
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "In Trust",
          data: beneficiaries.map((b) => b.inTrust),
          backgroundColor: IN_TRUST_COLOR,
          stack: "main",
          borderWidth: 0,
        },
      ],
    };
  }, [beneficiaries]);

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
              beneficiaries[items[0]?.dataIndex]?.label ?? "",
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
    [beneficiaries],
  );

  if (!data) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No beneficiary distributions to display.
      </p>
    );
  }

  return (
    <div style={{ height: 280 }}>
      <Bar data={data} options={options} />
    </div>
  );
}

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
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { data as brandData, dataLight as brandDataLight } from "@/brand";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

interface Props {
  /** Per-beneficiary outright/in-trust totals from
   *  `deriveBeneficiaryDistributionForm`. */
  beneficiaries: BeneficiaryDistributionTotal[];
}

/**
 * One bar per beneficiary, stacked into the outright portion (green) and
 * the in-trust portion (blue). Bar height is the beneficiary's total receipt
 * across both deaths.
 */
export function BeneficiaryDistributionFormChart({ beneficiaries }: Props) {
  const theme = useThemeName();

  const data = useMemo(() => {
    if (beneficiaries.length === 0) return null;
    const palette = theme === "light" ? brandDataLight : brandData;
    return {
      labels: beneficiaries.map((b) => truncate(b.label, 14)),
      datasets: [
        {
          label: "Outright",
          data: beneficiaries.map((b) => b.outright),
          backgroundColor: palette.green,
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "In Trust",
          data: beneficiaries.map((b) => b.inTrust),
          backgroundColor: palette.blue,
          stack: "main",
          borderWidth: 0,
        },
      ],
    };
  }, [beneficiaries, theme]);

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "bottom" as const,
          labels: { color: chrome.legend, boxWidth: 12, padding: 12 },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
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
          ticks: { color: chrome.tick, maxRotation: 0, autoSkip: false },
          grid: { color: chrome.grid },
        },
        y: {
          stacked: true,
          ticks: {
            color: chrome.tick,
            callback: (value: unknown) => fmt.format(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [beneficiaries, theme]);

  if (!data) {
    return (
      <p className="py-8 text-center text-sm text-ink-3">
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

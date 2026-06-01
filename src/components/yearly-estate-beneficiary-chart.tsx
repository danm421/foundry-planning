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
import { chartChrome, useThemeName } from "@/lib/chart-colors";

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
  const theme = useThemeName();

  const chartData = useMemo(() => {
    if (recipients.length === 0) return null;
    const chrome = chartChrome(theme);
    // Fallback to tick color when a recipient key has no assigned color
    const fallback = chrome.tick;
    return {
      labels: recipients.map((r) => truncate(r.recipientLabel, 14)),
      datasets: [
        {
          label: "From 1st Death",
          data: recipients.map((r) => r.fromFirstDeath),
          backgroundColor: recipients.map((r) =>
            withAlpha(colors[r.key] ?? fallback, "a6"),
          ),
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "From 2nd Death",
          data: recipients.map((r) => r.fromSecondDeath),
          backgroundColor: recipients.map(
            (r) => colors[r.key] ?? fallback,
          ),
          stack: "main",
          borderWidth: 0,
        },
      ],
    };
  }, [recipients, colors, theme]);

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
              recipients[items[0]?.dataIndex]?.recipientLabel ?? "",
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
  }, [recipients, theme]);

  if (!chartData) return null;

  const caption = buildCaption(firstDeathYear, secondDeathYear);

  return (
    <div className="space-y-2">
      {caption && <p className="text-[11px] text-ink-3">{caption}</p>}
      <div style={{ height: 280 }}>
        <Bar data={chartData} options={options} />
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

"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type {
  YearlyBeneficiaryBreakdown,
} from "@/lib/estate/yearly-beneficiary-breakdown";

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

interface Props {
  breakdown: YearlyBeneficiaryBreakdown;
  colors: Record<string, string>;
}

export function YearlyEstateBeneficiaryChart({ breakdown, colors }: Props) {
  const data = useMemo(() => {
    if (breakdown.rows.length === 0 || breakdown.beneficiaries.length === 0) {
      return null;
    }
    const labels = breakdown.rows.map((r: { year: number }) => String(r.year));
    const yearCount = breakdown.rows.length;
    // Two datasets per beneficiary: 1st-death (lighter) then 2nd-death (full).
    // Both use `stack: "main"` so they pile together per year.
    const datasets = breakdown.beneficiaries.flatMap((b: { key: string; recipientLabel: string }) => {
      const color = colors[b.key] ?? "#6b7280";
      const firstData = new Array<number>(yearCount).fill(0);
      const secondData = new Array<number>(yearCount).fill(0);
      breakdown.rows.forEach((row: { beneficiaries: Array<{ key: string; fromFirstDeath: number; fromSecondDeath: number }> }, idx: number) => {
        const share = row.beneficiaries.find((x: { key: string }) => x.key === b.key);
        if (!share) return;
        firstData[idx] = share.fromFirstDeath;
        secondData[idx] = share.fromSecondDeath;
      });
      return [
        {
          label: `${b.recipientLabel} — 1st death`,
          data: firstData,
          backgroundColor: withAlpha(color, "a6"),
          stack: "main",
          borderWidth: 0,
          /** Hide the 1st-death entry from the legend; the 2nd-death entry
           *  carries the recipient name. */
          beneficiaryKey: b.key,
          legendKind: "first" as const,
        },
        {
          label: `${b.recipientLabel} — 2nd death`,
          data: secondData,
          backgroundColor: color,
          stack: "main",
          borderWidth: 0,
          beneficiaryKey: b.key,
          legendKind: "second" as const,
        },
      ];
    });
    return { labels, datasets };
  }, [breakdown, colors]);

  const options = useMemo(
    () =>
      ({
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: "bottom" as const,
            labels: {
              color: "#d1d5db",
              boxWidth: 12,
              padding: 10,
              // Show one entry per beneficiary (the 2nd-death dataset),
              // with the label simplified to the recipient name.
              generateLabels: ((chart: unknown) => {
                const typedChart = chart as {
                  data: {
                    datasets: Array<{
                      label?: string;
                      backgroundColor?: string;
                      legendKind?: "first" | "second";
                      beneficiaryKey?: string;
                    }>;
                  };
                };
                const seen = new Set<string>();
                const items: Array<{
                  text: string;
                  fillStyle: string;
                  hidden: boolean;
                  datasetIndex: number;
                }> = [];
                typedChart.data.datasets.forEach((ds, i) => {
                  if (ds.legendKind !== "second") return;
                  if (!ds.beneficiaryKey || seen.has(ds.beneficiaryKey)) return;
                  seen.add(ds.beneficiaryKey);
                  const label =
                    ds.label?.replace(/ — 2nd death$/, "") ?? `Series ${i}`;
                  items.push({
                    text: label,
                    fillStyle: (ds.backgroundColor as string) ?? "#6b7280",
                    hidden: false,
                    datasetIndex: i,
                  });
                });
                return items;
              }) as unknown,
            },
          },
          tooltip: {
            mode: "index" as const,
            intersect: false,
            backgroundColor: "#1f2937",
            titleColor: "#f3f4f6",
            bodyColor: "#d1d5db",
            callbacks: {
              label: ((ctx: unknown) =>
                (() => {
                  const typedCtx = ctx as {
                    dataset: { label?: string };
                    raw: unknown;
                  };
                  return `${typedCtx.dataset.label}: ${fmt.format(Number(typedCtx.raw))}`;
                })()) as unknown,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: "#9ca3af" },
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
      }) as ChartOptions<'bar'>,
    [],
  );

  if (!data) return null;

  return (
    <div style={{ height: 280 }}>
      <Bar data={data} options={options} />
    </div>
  );
}

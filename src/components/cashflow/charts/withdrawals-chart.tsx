"use client";

import { useCallback, useRef } from "react";
import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";
import { useChartCapture } from "@/lib/report-artifacts/chart-capture";

const CATEGORY_LABELS: Record<string, string> = {
  taxable: "Taxable",
  retirement: "Retirement",
  cash: "Cash",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
};

const CATEGORY_COLORS: Record<string, string> = {
  retirement: "#f97316",
  taxable: "#facc15",
  cash: "#9ca3af",
  real_estate: "#0891b2",
  business: "#7c3aed",
  life_insurance: "#16a34a",
};

const FALLBACK_COLOR = "#ef4444";

export function buildWithdrawalsDatasets(
  years: ProjectionYear[],
  accountCategoryById: Record<string, string>,
): StackedBarSeries[] {
  const totals = new Map<string, number[]>();
  for (let yi = 0; yi < years.length; yi++) {
    const y = years[yi];
    for (const [accId, amt] of Object.entries(y.withdrawals.byAccount)) {
      const cat = accountCategoryById[accId] ?? "other";
      const label = CATEGORY_LABELS[cat] ?? "Other";
      if (!totals.has(label)) totals.set(label, new Array(years.length).fill(0));
      totals.get(label)![yi] += amt;
    }
  }
  const labels = [...totals.entries()]
    .filter(([, arr]) => arr.some((v) => v !== 0))
    .map(([label]) => label)
    .sort();

  return labels.map((label) => {
    const arr = totals.get(label)!;
    const cat = Object.entries(CATEGORY_LABELS).find(([, l]) => l === label)?.[0];
    const color = (cat && CATEGORY_COLORS[cat]) ?? FALLBACK_COLOR;
    return {
      label,
      color,
      valueFor: (year) => {
        const idx = years.indexOf(year);
        return idx >= 0 ? arr[idx] : 0;
      },
    };
  });
}

interface WithdrawalsChartProps {
  years: ProjectionYear[];
  accountCategoryById: Record<string, string>;
  dataVersion: string;
}

export function WithdrawalsChart({ years, accountCategoryById, dataVersion }: WithdrawalsChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useChartCapture(
    { reportId: "cashflow", chartId: "withdrawals", dataVersion },
    useCallback(() => ref.current?.querySelector("canvas") ?? null, []),
  );
  return (
    <div ref={ref}>
      <StackedBarChart
        years={years}
        series={buildWithdrawalsDatasets(years, accountCategoryById)}
        title="Withdrawals by category"
      />
    </div>
  );
}

"use client";

import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";

const SUB_TYPE_LABELS: Record<string, string> = {
  "401k": "401k",
  "403b": "403b",
  "ira": "IRA",
  "roth_ira": "Roth IRA",
  "roth_401k": "Roth 401k",
  "brokerage": "Brokerage",
  "hsa": "HSA",
  "529": "529",
  "checking": "Cash",
  "savings": "Cash",
};

const SUB_TYPE_COLORS: Record<string, string> = {
  "401k": "#16a34a",
  "403b": "#16a34a",
  "ira": "#2563eb",
  "roth_ira": "#7c3aed",
  "roth_401k": "#7c3aed",
  "brokerage": "#facc15",
  "hsa": "#0891b2",
  "529": "#ea580c",
  "checking": "#9ca3af",
  "savings": "#9ca3af",
};

const FALLBACK_COLOR = "#99f6e4";

export function buildSavingsDatasets(
  years: ProjectionYear[],
  accountSubTypes: Record<string, string>,
): StackedBarSeries[] {
  // Sum each year's contributions by labeled sub-type bucket.
  const totals = new Map<string, number[]>();

  for (let yi = 0; yi < years.length; yi++) {
    const y = years[yi];
    for (const [accId, amt] of Object.entries(y.savings.byAccount)) {
      const subType = accountSubTypes[accId];
      const label = subType ? (SUB_TYPE_LABELS[subType] ?? "Other") : "Other";
      if (!totals.has(label)) totals.set(label, new Array(years.length).fill(0));
      totals.get(label)![yi] += amt;
    }
  }

  // Drop labels that never had a non-zero contribution across the projection.
  const labels = [...totals.entries()]
    .filter(([, arr]) => arr.some((v) => v !== 0))
    .map(([label]) => label)
    .sort();

  return labels.map((label) => {
    const arr = totals.get(label)!;
    // Pick the color from the first sub-type that maps to this label.
    const subType = Object.entries(SUB_TYPE_LABELS).find(([, l]) => l === label)?.[0];
    const color = (subType && SUB_TYPE_COLORS[subType]) ?? FALLBACK_COLOR;
    return {
      label,
      color,
      valueFor: (year: ProjectionYear) => {
        const idx = years.indexOf(year);
        return idx >= 0 ? arr[idx] : 0;
      },
    };
  });
}

interface SavingsChartProps {
  years: ProjectionYear[];
  accountSubTypes: Record<string, string>;
}

export function SavingsChart({ years, accountSubTypes }: SavingsChartProps) {
  return (
    <StackedBarChart
      years={years}
      series={buildSavingsDatasets(years, accountSubTypes)}
      title="Savings by account type"
    />
  );
}

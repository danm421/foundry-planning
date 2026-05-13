"use client";

import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";

export function buildTaxStateDatasets(): StackedBarSeries[] {
  // Phase 1: single-series bar of total state income tax per year. State-tax
  // sub-components (preCreditTax vs exemptionCredits, special-rule
  // adjustments) vary too much across states to stack uniformly — split them
  // in a future pass once the report stabilizes.
  return [
    {
      label: "State Income Tax",
      color: "#0891b2", // cyan-600 — distinct from federal blue/green palette
      valueFor: (y: ProjectionYear) => y.taxResult?.state?.stateTax ?? 0,
    },
  ];
}

interface TaxStateChartProps {
  years: ProjectionYear[];
}

export function TaxStateChart({ years }: TaxStateChartProps) {
  return (
    <StackedBarChart
      years={years}
      series={buildTaxStateDatasets()}
      title="State income tax"
    />
  );
}

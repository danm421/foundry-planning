"use client";

import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";

export function buildTaxFederalDatasets(): StackedBarSeries[] {
  return [
    {
      label: "Ordinary (Bracket)",
      color: "#2563eb",
      valueFor: (y: ProjectionYear) => y.taxResult?.flow.regularFederalIncomeTax ?? 0,
    },
    {
      label: "Cap Gains / QDIV",
      color: "#16a34a",
      valueFor: (y: ProjectionYear) => y.taxResult?.flow.capitalGainsTax ?? 0,
    },
    {
      label: "NIIT",
      color: "#ea580c",
      valueFor: (y: ProjectionYear) => y.taxResult?.flow.niit ?? 0,
    },
    {
      label: "AMT",
      color: "#7c3aed",
      valueFor: (y: ProjectionYear) => y.taxResult?.flow.amtAdditional ?? 0,
    },
  ];
}

interface TaxFederalChartProps {
  years: ProjectionYear[];
}

export function TaxFederalChart({ years }: TaxFederalChartProps) {
  return (
    <StackedBarChart
      years={years}
      series={buildTaxFederalDatasets()}
      title="Federal tax components"
    />
  );
}

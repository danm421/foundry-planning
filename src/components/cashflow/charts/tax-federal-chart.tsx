"use client";

import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";

export function buildTaxFederalDatasets(): StackedBarSeries[] {
  return [
    {
      label: "Ordinary (Bracket)",
      colorKey: "blue",
      valueFor: (y: ProjectionYear) => y.taxResult?.flow.regularFederalIncomeTax ?? 0,
    },
    {
      label: "Cap Gains / QDIV",
      colorKey: "green",
      valueFor: (y: ProjectionYear) => y.taxResult?.flow.capitalGainsTax ?? 0,
    },
    {
      label: "NIIT",
      colorKey: "orange",
      valueFor: (y: ProjectionYear) => y.taxResult?.flow.niit ?? 0,
    },
    {
      label: "AMT",
      colorKey: "purple",
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

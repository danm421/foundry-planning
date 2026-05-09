"use client";

import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";

export function buildTaxIncomeDatasets(): StackedBarSeries[] {
  return [
    { label: "Earned", color: "#16a34a", valueFor: (y) => y.taxDetail?.earnedIncome ?? 0 },
    { label: "Ordinary", color: "#2563eb", valueFor: (y) => y.taxDetail?.ordinaryIncome ?? 0 },
    { label: "Qualified Dividends", color: "#0891b2", valueFor: (y) => y.taxDetail?.dividends ?? 0 },
    { label: "LT Capital Gains", color: "#facc15", valueFor: (y) => y.taxDetail?.capitalGains ?? 0 },
    { label: "ST Capital Gains", color: "#ea580c", valueFor: (y) => y.taxDetail?.stCapitalGains ?? 0 },
    { label: "QBI", color: "#7c3aed", valueFor: (y) => y.taxDetail?.qbi ?? 0 },
    { label: "Tax-Exempt", color: "#9ca3af", valueFor: (y) => y.taxDetail?.taxExempt ?? 0 },
  ];
}

interface TaxIncomeChartProps {
  years: ProjectionYear[];
}

export function TaxIncomeChart({ years }: TaxIncomeChartProps) {
  return <StackedBarChart years={years} series={buildTaxIncomeDatasets()} title="Taxable income breakdown" />;
}

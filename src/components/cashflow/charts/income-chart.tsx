"use client";

import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";

export function buildIncomeDatasets(): StackedBarSeries[] {
  return [
    { label: "Salaries", color: "#16a34a", valueFor: (y) => y.income.salaries },
    { label: "Social Security", color: "#2563eb", valueFor: (y) => y.income.socialSecurity },
    { label: "Business", color: "#0891b2", valueFor: (y) => y.income.business },
    { label: "Trust", color: "#7c3aed", valueFor: (y) => y.income.trust },
    { label: "Deferred", color: "#ea580c", valueFor: (y) => y.income.deferred },
    { label: "Capital Gains", color: "#facc15", valueFor: (y) => y.income.capitalGains },
    { label: "Other", color: "#99f6e4", valueFor: (y) => y.income.other },
  ];
}

interface IncomeChartProps {
  years: ProjectionYear[];
}

export function IncomeChart({ years }: IncomeChartProps) {
  return <StackedBarChart years={years} series={buildIncomeDatasets()} title="Income by source" />;
}
